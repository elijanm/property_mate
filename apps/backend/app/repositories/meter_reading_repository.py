from typing import List, Optional, Tuple

from app.models.meter_reading import MeterReading
from beanie import Document, PydanticObjectId

class MeterReadingRepository:
    async def create(self, reading: MeterReading) -> MeterReading:
        await reading.insert()
        return reading

    async def get_latest(
        self,
        org_id: str,
        unit_id: str,
        utility_key: str,
    ) -> Optional[MeterReading]:
        """Return the most recent non-deleted reading for a unit+utility."""
        return (
            await MeterReading.find(
                {
                    "org_id": org_id,
                    "unit_id": unit_id,
                    "utility_key": utility_key,
                    "deleted_at": None,
                }
            )
            .sort("-read_at")
            .limit(1)
            .first_or_none()
        )

    async def list(
        self,
        org_id: str,
        property_id: str,
        unit_id: Optional[str] = None,
        utility_key: Optional[str] = None,
        skip: int = 0,
        limit: int = 20,
    ) -> Tuple[List[MeterReading], int]:
        filters: dict = {
            "org_id": org_id,
            "property_id": property_id,
            "deleted_at": None,
        }
        if unit_id:
            filters["unit_id"] = unit_id
        if utility_key:
            filters["utility_key"] = utility_key

        query = MeterReading.find(filters).sort("-read_at")
        total = await query.count()
        items = await query.skip(skip).limit(limit).to_list()
        return items, total


meter_reading_repository = MeterReadingRepository()
