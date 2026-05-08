import enum
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column
from ..database import Base


class UserRole(str, enum.Enum):
    super_admin = "super_admin"
    marketing_manager = "marketing_manager"
    content_creator = "content_creator"
    affiliate_manager = "affiliate_manager"
    analyst = "analyst"

    @property
    def can_approve_posts(self) -> bool:
        return self in (UserRole.super_admin, UserRole.marketing_manager)

    @property
    def can_approve_ads(self) -> bool:
        return self in (UserRole.super_admin, UserRole.marketing_manager)

    @property
    def can_enable_autonomous(self) -> bool:
        return self == UserRole.super_admin


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        SQLEnum(UserRole, name="userrole"),
        default=UserRole.content_creator,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    last_login: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
