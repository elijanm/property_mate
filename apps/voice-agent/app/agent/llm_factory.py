"""Factory that creates the appropriate Pipecat LLM service from config."""
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.anthropic.llm import AnthropicLLMService
from app.core.config import settings


def create_llm_service(cfg: dict | None = None):
    """Return a configured LLM service instance.

    Values from *cfg* (InstalledApp.config) take precedence over env settings.
    """
    cfg = cfg or {}
    provider = cfg.get("llm_provider") or settings.LLM_PROVIDER
    api_key = cfg.get("llm_api_key") or settings.LLM_API_KEY
    model = cfg.get("llm_model") or settings.LLM_MODEL
    base_url = (cfg.get("llm_base_url") or settings.LLM_BASE_URL or "").strip() or None

    if provider == "anthropic":
        return AnthropicLLMService(
            api_key=api_key,
            model=model,
            params=AnthropicLLMService.InputParams(
                temperature=settings.LLM_TEMPERATURE,
                max_tokens=settings.LLM_MAX_TOKENS,
            ),
        )

    # openai or openai_compatible (Ollama, Groq, Together, etc.)
    kwargs: dict = {
        "api_key": api_key or "ollama",
        "model": model,
        "params": OpenAILLMService.InputParams(
            temperature=settings.LLM_TEMPERATURE,
            max_tokens=settings.LLM_MAX_TOKENS,
        ),
    }
    if provider == "openai_compatible" and base_url:
        kwargs["base_url"] = base_url

    return OpenAILLMService(**kwargs)
