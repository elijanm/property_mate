from fastapi import Query
from dataclasses import dataclass


@dataclass
class PaginationParams:
    page: int
    page_size: int

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.page_size


def get_pagination(
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=20, ge=1, le=500, description="Items per page"),
) -> PaginationParams:
    return PaginationParams(page=page, page_size=page_size)
