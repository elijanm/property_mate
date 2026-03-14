from datetime import datetime, timezone
from typing import Optional
from app.models.installed_app import InstalledApp


class InstalledAppRepository:

    async def get_by_app_id(self, org_id: str, app_id: str) -> Optional[InstalledApp]:
        return await InstalledApp.find_one(
            {"org_id": org_id, "app_id": app_id, "deleted_at": None}
        )

    async def list_for_org(self, org_id: str) -> list[InstalledApp]:
        return await InstalledApp.find(
            {"org_id": org_id, "deleted_at": None}
        ).to_list()

    async def create(self, app: InstalledApp) -> InstalledApp:
        await app.insert()
        return app

    async def update_config(self, app: InstalledApp, config: dict) -> InstalledApp:
        app.config = config
        app.updated_at = datetime.now(timezone.utc)
        await app.save()
        return app

    async def update_status(self, app: InstalledApp, status: str) -> InstalledApp:
        app.status = status
        app.updated_at = datetime.now(timezone.utc)
        await app.save()
        return app

    async def soft_delete(self, app: InstalledApp) -> None:
        app.deleted_at = datetime.now(timezone.utc)
        await app.save()
