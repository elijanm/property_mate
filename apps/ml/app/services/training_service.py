"""Orchestrates training: config resolution, data loading, MLflow logging, model save."""
import io
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple, Type

import mlflow
import structlog

from app.abstract.base_trainer import BaseTrainer, EvaluationResult, TrainingConfig
from app.core.config import settings
from app.models.training_job import TrainingJob
from app.models.training_config import TrainingConfig as TrainingConfigDoc
from app.services.registry_service import get_trainer_class
from app.utils.datetime import utc_now

logger = structlog.get_logger(__name__)


async def get_training_config(extra: Optional[Dict] = None) -> TrainingConfig:
    """Merge DB config + env defaults + per-job overrides."""
    db_cfg = await TrainingConfigDoc.find_one(TrainingConfigDoc.key == "global")

    # Start from env defaults
    cfg = TrainingConfig(
        device=settings.get_device(),
        workers=settings.TRAINING_WORKERS,
        batch_size=settings.TRAINING_BATCH_SIZE,
        fp16=settings.TRAINING_FP16,
        mixed_precision=settings.TRAINING_MIXED_PRECISION,
        max_epochs=settings.TRAINING_MAX_EPOCHS,
        early_stopping=settings.TRAINING_EARLY_STOPPING,
        early_stopping_patience=settings.TRAINING_EARLY_STOPPING_PATIENCE,
        test_split=settings.TRAINING_TEST_SPLIT,
        val_split=settings.TRAINING_VAL_SPLIT,
        random_seed=settings.TRAINING_RANDOM_SEED,
        optimizer=settings.TRAINING_OPTIMIZER,
        learning_rate=settings.TRAINING_LEARNING_RATE,
        weight_decay=settings.TRAINING_WEIGHT_DECAY,
        gradient_clip=settings.TRAINING_GRADIENT_CLIP,
        lr_scheduler=settings.TRAINING_LR_SCHEDULER,
        warmup_ratio=settings.TRAINING_WARMUP_RATIO,
        task=settings.TRAINING_TASK,
    )

    # Override with DB config when present
    if db_cfg:
        cfg.device = db_cfg.cuda_device if db_cfg.cuda_device != "auto" else settings.get_device()
        cfg.workers = db_cfg.workers
        cfg.batch_size = db_cfg.batch_size
        cfg.fp16 = db_cfg.fp16
        cfg.mixed_precision = db_cfg.mixed_precision
        cfg.max_epochs = db_cfg.max_epochs
        cfg.early_stopping = db_cfg.early_stopping
        cfg.early_stopping_patience = db_cfg.early_stopping_patience
        cfg.test_split = db_cfg.test_split
        cfg.val_split = db_cfg.val_split
        cfg.random_seed = db_cfg.random_seed
        cfg.optimizer = db_cfg.optimizer
        cfg.learning_rate = db_cfg.learning_rate
        cfg.weight_decay = db_cfg.weight_decay
        cfg.gradient_clip = db_cfg.gradient_clip
        cfg.lr_scheduler = db_cfg.lr_scheduler
        cfg.warmup_ratio = db_cfg.warmup_ratio
        cfg.task = db_cfg.task
        if db_cfg.num_classes is not None:
            cfg.num_classes = db_cfg.num_classes
        cfg.extra = db_cfg.extra or {}

    if extra:
        cfg.extra.update(extra)
    return cfg


async def run_training(job_id: str, injected_data: Optional[bytes] = None) -> None:
    """
    Core training logic. Called by Celery task.
    Updates TrainingJob document at every state transition.
    """
    job = await TrainingJob.get(job_id)
    if not job:
        logger.error("training_job_not_found", job_id=job_id)
        return

    trainer_cls = get_trainer_class(job.trainer_name)
    if not trainer_cls:
        # Try to load the plugin file directly to surface the actual import error
        error_msg = f"Trainer '{job.trainer_name}' not registered"
        try:
            import importlib.util
            from pathlib import Path
            plugin_dir = Path(settings.TRAINER_PLUGIN_DIR)
            candidates = list(plugin_dir.glob("*.py"))
            match = next(
                (f for f in candidates if f.stem == job.trainer_name or f.stem.lower() == job.trainer_name.lower()),
                None,
            )
            if match:
                spec = importlib.util.spec_from_file_location("_probe", match)
                if spec and spec.loader:
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)  # type: ignore[union-attr]
                    error_msg += " — file loaded but no valid BaseTrainer subclass found (check name/data_source attrs)"
            else:
                error_msg += f" — no matching .py file in {plugin_dir}"
        except Exception as probe_exc:
            error_msg += f" — import error: {probe_exc}"
        await _fail(job, error_msg)
        return

    # Block resource-intensive trainers from local execution
    from app.models.trainer_registration import TrainerRegistration
    trainer_reg = await TrainerRegistration.find_one(TrainerRegistration.name == job.trainer_name)
    if trainer_reg and trainer_reg.resource_intensive:
        await _fail(
            job,
            f"Trainer '{job.trainer_name}' has been marked as resource-intensive "
            "and cannot run locally. Please use Cloud GPU.",
        )
        return

    trainer: BaseTrainer = trainer_cls()
    config = await get_training_config(job.training_config.get("extra"))

    # Mark running
    await job.set({"status": "running", "started_at": utc_now(), "updated_at": utc_now()})

    mlflow.set_tracking_uri(settings.MLFLOW_TRACKING_URI)
    experiment = mlflow.set_experiment(settings.MLFLOW_DEFAULT_EXPERIMENT)

    with mlflow.start_run(
        experiment_id=experiment.experiment_id,
        run_name=f"{job.trainer_name}_job_{job_id[:8]}",
        tags={
            "trainer": job.trainer_name,
            "version": job.trainer_version,
            "trigger": job.trigger,
            "job_id": job_id,
        },
    ) as run:
        await job.set({"run_id": run.info.run_id, "experiment_id": experiment.experiment_id, "updated_at": utc_now()})

        try:
            # Log config
            mlflow.log_params({
                "device": config.device,
                "workers": config.workers,
                "batch_size": config.batch_size,
                "fp16": config.fp16,
                "mixed_precision": config.mixed_precision,
                "max_epochs": config.max_epochs,
                "test_split": config.test_split,
                "val_split": config.val_split,
                "random_seed": config.random_seed,
                "optimizer": config.optimizer,
                "learning_rate": config.learning_rate,
                "weight_decay": config.weight_decay,
                "gradient_clip": config.gradient_clip,
                "lr_scheduler": config.lr_scheduler,
                "warmup_ratio": config.warmup_ratio,
                "task": config.task,
            })

            # Load data
            await _log(job, "Loading data...")
            if injected_data:
                from app.abstract.data_source import UploadedFileDataSource
                if isinstance(trainer.data_source, UploadedFileDataSource):
                    trainer.data_source.inject(injected_data)
            # Inject org_id so DatasetDataSource can auto-create missing datasets
            from app.abstract.data_source import DatasetDataSource
            if isinstance(trainer.data_source, DatasetDataSource) and job.org_id:
                trainer.data_source.org_id = job.org_id
            raw_data = await trainer.data_source.load(injected_data=injected_data)
            await _log(job, f"Data loaded ({len(raw_data) if isinstance(raw_data, (bytes, list)) else 'n/a'} bytes/items)")

            # Preprocess
            await _log(job, "Preprocessing...")
            preprocessed = trainer.preprocess(raw_data)

            # Train
            await _log(job, f"Training on {config.device}...")
            t0 = time.monotonic()
            result = trainer.train(preprocessed, config)
            elapsed = time.monotonic() - t0
            mlflow.log_metric("training_duration_s", elapsed)

            # Unpack optional test_data
            model = result
            test_data = None
            if isinstance(result, tuple) and len(result) == 2:
                model, test_data = result

            # Evaluate
            eval_result: Optional[EvaluationResult] = None
            if test_data is not None:
                await _log(job, "Evaluating...")
                try:
                    eval_result = trainer.evaluate(model, test_data)
                    metrics = _eval_to_metrics(eval_result)
                    mlflow.log_metrics(metrics)
                    await job.set({"metrics": metrics, "updated_at": utc_now()})
                    await _log(job, f"Metrics: {metrics}")
                    # Log schemas + visualisations as MLflow artifacts
                    _log_schema_artifacts(trainer_cls)
                    class_names = trainer.get_class_names() if hasattr(trainer, "get_class_names") else []
                    _log_confusion_matrix_artifacts(eval_result, class_names)
                    _log_metrics_chart(metrics)
                except NotImplementedError:
                    await _log(job, "evaluate() not implemented — skipping")

            # Save model to MLflow
            await _log(job, "Saving model to MLflow...")
            model_uri = _log_model_to_mlflow(trainer, model)
            await _log(job, f"Model saved: {model_uri}")
            mlflow.log_param("model_uri", model_uri)

            # Register in MLflow Model Registry (optional — requires SQL backend)
            registered_name = job.trainer_name
            model_version = "1"
            final_uri = model_uri  # fallback: use runs:/ URI directly
            try:
                mv = mlflow.register_model(model_uri, registered_name)
                final_uri = f"models:/{registered_name}/{mv.version}"
                model_version = str(mv.version)
                await _log(job, f"Registered as {registered_name} v{model_version}")
            except Exception as reg_exc:
                logger.warning("mlflow_registry_skipped", reason=str(reg_exc))
                await _log(job, f"Registry unavailable — using run URI directly: {model_uri}")

            # Persist deployment record
            # sample_preinstall trigger → mark as visible to all roles (viewer-accessible)
            _visibility = "viewer" if job.trigger == "sample_preinstall" else "engineer"
            from app.models.model_deployment import ModelDeployment
            dep = ModelDeployment(
                org_id=job.org_id,
                trainer_name=job.trainer_name,
                version=job.trainer_version,
                mlflow_model_name=registered_name,
                mlflow_model_version=model_version,
                run_id=run.info.run_id,
                model_uri=final_uri,
                metrics=_eval_to_metrics(eval_result) if eval_result else {},
                tags=trainer.tags,
                input_schema=getattr(trainer_cls, "input_schema", {}),
                output_schema=getattr(trainer_cls, "output_schema", {}),
                category=getattr(trainer_cls, "category", {}),
                is_default=True,
                visibility=_visibility,
                owner_email=job.owner_email,
            )
            # Demote previous default(s) within same org
            prev_defaults = await ModelDeployment.find(
                ModelDeployment.org_id == job.org_id,
                ModelDeployment.trainer_name == job.trainer_name,
                ModelDeployment.is_default == True,  # noqa: E712
            ).to_list()
            for prev in prev_defaults:
                await prev.set({"is_default": False})
            await dep.insert()

            # Update trainer's last_trained_at
            from app.models.trainer_registration import TrainerRegistration
            reg = await TrainerRegistration.find_one(TrainerRegistration.name == job.trainer_name)
            if reg:
                await reg.set({"last_trained_at": utc_now(), "updated_at": utc_now()})

            finished_at = utc_now()
            await job.set({
                "status": "completed",
                "model_uri": final_uri,
                "finished_at": finished_at,
                "updated_at": finished_at,
            })
            await _log(job, "Training complete.")

            # Local training billing + plan usage recording
            if job.compute_type == "local" and job.owner_email:
                try:
                    from app.services import wallet_service, ml_billing_service

                    # Charge wallet if funds were reserved for this job
                    if job.wallet_reserved > 0 and job.gpu_price_per_hour:
                        actual_cost = round(job.gpu_price_per_hour * (elapsed / 3600), 4)
                        wallet = await wallet_service.get_or_create(job.owner_email, job.org_id)
                        charged = await wallet_service.release_and_charge(
                            wallet, str(job.id), actual_cost
                        )
                        await job.set({"wallet_charged": charged, "updated_at": utc_now()})
                        logger.info(
                            "local_training_charged",
                            job_id=job_id,
                            elapsed_s=round(elapsed, 1),
                            price_per_hour=job.gpu_price_per_hour,
                            actual_cost=actual_cost,
                            charged=charged,
                        )

                    # Record plan usage (always, even for free jobs)
                    user_plan = await ml_billing_service.get_or_create_user_plan(
                        job.owner_email, job.org_id
                    )
                    if user_plan:
                        await ml_billing_service.consume_training_seconds(user_plan, elapsed)

                    # Legacy quota tracking (keep for backwards compat)
                    wallet_q = await wallet_service.get_or_create(job.owner_email, job.org_id)
                    await wallet_service.consume_local_time(wallet_q, elapsed)

                except Exception as quota_exc:
                    logger.warning("local_billing_record_failed", job_id=job_id, error=str(quota_exc))

        except Exception as exc:
            logger.error("training_failed", job_id=job_id, error=str(exc), exc_info=exc)
            mlflow.set_tag("error", str(exc))
            await _fail(job, str(exc))


def _log_model_to_mlflow(trainer: BaseTrainer, model: Any) -> str:
    """Save model using appropriate MLflow flavor."""
    import tempfile, os
    artifact_path = "model"
    example = trainer.get_input_example()
    framework = getattr(trainer, "framework", "custom")

    try:
        if framework == "sklearn":
            import mlflow.sklearn
            mlflow.sklearn.log_model(model, artifact_path, input_example=example)
        elif framework == "pytorch":
            import mlflow.pytorch
            mlflow.pytorch.log_model(model, artifact_path, input_example=example)
        elif framework == "tensorflow":
            import mlflow.tensorflow
            mlflow.tensorflow.log_model(model, artifact_path, input_example=example)
        else:
            import mlflow.pyfunc
            mlflow.pyfunc.log_model(
                artifact_path,
                python_model=_PickleWrapper(model),
                input_example=example,
            )
    except Exception as primary_exc:
        # Fallback: pickle to a temp file then log as artifact + pyfunc wrapper
        logger.warning("mlflow_flavor_log_failed", error=str(primary_exc), framework=framework)
        try:
            import cloudpickle
            tmp = tempfile.NamedTemporaryFile(suffix=".pkl", delete=False)
            try:
                cloudpickle.dump(model, tmp)
                tmp.flush()
                tmp.close()
                mlflow.log_artifact(tmp.name, artifact_path)
                mlflow.pyfunc.log_model(
                    artifact_path + "_pyfunc",
                    python_model=_PickleWrapper(model),
                )
            finally:
                os.unlink(tmp.name)
        except Exception as fallback_exc:
            logger.error("mlflow_fallback_log_failed", error=str(fallback_exc))

    run_id = mlflow.active_run().info.run_id
    return f"runs:/{run_id}/{artifact_path}"


def _log_schema_artifacts(trainer_cls: Type) -> None:
    """Log input_schema and output_schema as JSON artifacts under schemas/."""
    import json
    import tempfile
    import os

    for name, data in [
        ("input_schema.json", getattr(trainer_cls, "input_schema", {})),
        ("output_schema.json", getattr(trainer_cls, "output_schema", {})),
    ]:
        if not data:
            continue
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(data, f, indent=2)
            tmp = f.name
        try:
            mlflow.log_artifact(tmp, "schemas")
        except Exception:
            pass
        finally:
            os.unlink(tmp)


def _log_confusion_matrix_artifacts(
    eval_result: Optional[EvaluationResult], class_names: list
) -> None:
    """Log confusion matrix PNGs under plots/."""
    if not eval_result or not eval_result.y_true or not eval_result.y_pred:
        return
    try:
        import tempfile
        import os

        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from sklearn.metrics import ConfusionMatrixDisplay, confusion_matrix
        import numpy as np

        cm = confusion_matrix(eval_result.y_true, eval_result.y_pred)
        labels = class_names or [str(i) for i in range(cm.shape[0])]
        n = len(labels)
        figsize = (max(6, n * 1.2), max(5, n))

        for suffix, data, fmt, title in [
            ("confusion_matrix.png", cm, "d", "Confusion Matrix"),
            (
                "confusion_matrix_normalized.png",
                (cm.astype(float) / cm.sum(axis=1, keepdims=True).clip(min=1)),
                ".2f",
                "Confusion Matrix (Normalized)",
            ),
        ]:
            fig, ax = plt.subplots(figsize=figsize)
            ConfusionMatrixDisplay(confusion_matrix=data, display_labels=labels).plot(
                ax=ax, cmap="Blues", values_format=fmt
            )
            ax.set_title(title)
            plt.tight_layout()
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                tmp = f.name
            try:
                plt.savefig(tmp, dpi=120, bbox_inches="tight")
                mlflow.log_artifact(tmp, "plots")
            except Exception:
                pass
            finally:
                plt.close(fig)
                os.unlink(tmp)
    except Exception as exc:
        logger.warning("confusion_matrix_log_failed", error=str(exc))


def _log_metrics_chart(metrics: dict) -> None:
    """Log a bar chart of final eval metrics under plots/."""
    if not metrics:
        return
    try:
        import tempfile
        import os

        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        keys = [k for k in metrics if isinstance(metrics[k], float) and 0 <= metrics[k] <= 1]
        if not keys:
            return
        vals = [metrics[k] for k in keys]

        fig, ax = plt.subplots(figsize=(max(5, len(keys) * 1.4), 4))
        bars = ax.bar(keys, vals, color="#6366f1", alpha=0.85)
        ax.set_ylim(0, 1.1)
        ax.set_ylabel("Score")
        ax.set_title("Training Metrics Summary")
        for bar, val in zip(bars, vals):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + 0.02,
                f"{val:.3f}",
                ha="center",
                va="bottom",
                fontsize=10,
            )
        plt.tight_layout()
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            tmp = f.name
        try:
            plt.savefig(tmp, dpi=120, bbox_inches="tight")
            mlflow.log_artifact(tmp, "plots")
        except Exception:
            pass
        finally:
            plt.close(fig)
            os.unlink(tmp)
    except Exception as exc:
        logger.warning("metrics_chart_log_failed", error=str(exc))


def _eval_to_metrics(result: Optional[EvaluationResult]) -> Dict[str, float]:
    if not result:
        return {}
    out = {}
    for key in ("accuracy", "precision", "recall", "f1", "roc_auc", "mse", "mae", "r2"):
        val = getattr(result, key, None)
        if val is not None:
            out[key] = float(val)
    out.update(result.extra_metrics or {})
    return out


async def _log(job: TrainingJob, line: str) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    await job.update({"$push": {"log_lines": f"[{ts}] {line}"}})


async def _fail(job: TrainingJob, error: str) -> None:
    await job.set({
        "status": "failed",
        "error": error,
        "finished_at": utc_now(),
        "updated_at": utc_now(),
    })


class _PickleWrapper(mlflow.pyfunc.PythonModel):
    def __init__(self, model):
        self._model = model

    def predict(self, context, model_input):
        return self._model.predict(model_input)
