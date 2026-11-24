"""Customer records as they come out of the CRM."""
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Customer:
    email: str
    name: str
    verified: bool
    updated_at: datetime
