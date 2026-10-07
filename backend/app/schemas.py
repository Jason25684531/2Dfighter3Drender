from typing import Literal

from pydantic import BaseModel, Field


class PlayerCreate(BaseModel):
    nickname: str = Field(min_length=1, max_length=16)
    language: str = Field(min_length=1, max_length=16)
    client_request_id: str = Field(min_length=1, max_length=128)


class PlayerOut(BaseModel):
    id: int
    nickname: str
    language: str
    created_at: str


class SessionCreate(BaseModel):
    player_id: int
    selected_character: str | None = None
    client_request_id: str = Field(min_length=1, max_length=128)


class SessionUpdate(BaseModel):
    selected_character: str | None = None
    client_request_id: str = Field(min_length=1, max_length=128)


class MutationRequest(BaseModel):
    client_request_id: str = Field(min_length=1, max_length=128)
