"""StockShipment model — waybill with driver/receiver online signing."""
import uuid
from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, IndexModel

from app.utils.datetime import utc_now


class ShipmentSignature(BaseModel):
    signed_by_name: str
    signed_at: datetime
    ip_address: Optional[str] = None
    signature_key: str   # S3 PNG key


class ShipmentItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    item_id: str            # InventoryItem MongoDB ObjectId (str)
    item_name: str
    quantity: float
    unit_of_measure: str
    serial_numbers: List[str] = []
    weight_per_unit: Optional[float] = None  # kg
    line_weight: float = 0.0    # weight_per_unit * quantity


class StockShipment(Document):
    id: PydanticObjectId = Field(default_factory=PydanticObjectId)
    org_id: str

    reference_number: str   # SHP-XXXXXX
    # stock_out | transfer
    movement_type: str

    items: List[ShipmentItem] = []
    total_weight: float = 0.0

    tracking_number: Optional[str] = None
    driver_name: str
    driver_phone: Optional[str] = None
    driver_email: Optional[str] = None
    vehicle_number: Optional[str] = None
    destination: str
    receiver_name: Optional[str] = None
    receiver_phone: Optional[str] = None
    receiver_email: Optional[str] = None

    # draft | pending_driver | driver_signed | pending_receiver | delivered | cancelled
    status: str = "draft"

    driver_sign_token: Optional[str] = None
    driver_signature: Optional[ShipmentSignature] = None

    receiver_sign_token: Optional[str] = None
    receiver_signature: Optional[ShipmentSignature] = None

    pdf_key: Optional[str] = None
    notes: Optional[str] = None
    created_by: str

    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    class Settings:
        name = "stock_shipments"
        indexes = [
            IndexModel([("org_id", ASCENDING), ("status", ASCENDING)]),
            IndexModel(
                [("org_id", ASCENDING), ("reference_number", ASCENDING)],
                unique=True,
            ),
            IndexModel(
                [("driver_sign_token", ASCENDING)],
                unique=True,
                partialFilterExpression={"driver_sign_token": {"$type": "string"}},
            ),
            IndexModel(
                [("receiver_sign_token", ASCENDING)],
                unique=True,
                partialFilterExpression={"receiver_sign_token": {"$type": "string"}},
            ),
        ]
