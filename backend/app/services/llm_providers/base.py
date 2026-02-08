"""
Base classes for LLM and Embedding providers.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Generator, Any, Optional
from enum import Enum


class ProviderType(str, Enum):
    """Supported LLM provider types."""
    OLLAMA = "ollama"
    OPENAI = "openai"
    GEMINI = "gemini"
    CLAUDE = "claude"


class EmbeddingProviderType(str, Enum):
    """Supported embedding provider types."""
    OLLAMA = "ollama"
    OPENAI = "openai"


@dataclass
class LLMResponse:
    """Response from an LLM provider."""
    content: str
    model: str
    provider: str
    tokens_used: int = 0
    finish_reason: str = ""
    metadata: dict = field(default_factory=dict)


@dataclass
class ProviderConfig:
    """Configuration for an LLM provider."""
    provider_type: ProviderType
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: str = ""
    temperature: float = 0.7
    max_tokens: int = 4096
    extra_params: dict = field(default_factory=dict)


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""
    
    provider_type: ProviderType
    
    def __init__(self, config: ProviderConfig):
        self.config = config
        self._validate_config()
    
    @abstractmethod
    def _validate_config(self) -> None:
        """Validate provider-specific configuration."""
        pass
    
    @abstractmethod
    def generate(self, prompt: str, **kwargs) -> LLMResponse:
        """Generate a response synchronously."""
        pass
    
    @abstractmethod
    def generate_stream(self, prompt: str, **kwargs) -> Generator[str, None, None]:
        """Generate a streaming response."""
        pass
    
    @abstractmethod
    def list_models(self) -> list[str]:
        """List available models."""
        pass
    
    @abstractmethod
    def is_available(self) -> bool:
        """Check if provider is available/configured."""
        pass
    
    def get_model(self) -> str:
        """Get current model name."""
        return self.config.model
    
    def set_model(self, model: str) -> None:
        """Set the model to use."""
        self.config.model = model


class EmbeddingProvider(ABC):
    """Abstract base class for embedding providers."""
    
    provider_type: EmbeddingProviderType
    
    def __init__(self, config: ProviderConfig):
        self.config = config
    
    @abstractmethod
    def embed_text(self, text: str) -> list[float]:
        """Generate embedding for a single text."""
        pass
    
    @abstractmethod
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts."""
        pass
    
    @abstractmethod
    def get_embedding_dimension(self) -> int:
        """Get the dimension of embeddings produced."""
        pass
    
    @abstractmethod
    def is_available(self) -> bool:
        """Check if provider is available."""
        pass
