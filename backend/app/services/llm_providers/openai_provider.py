"""
OpenAI LLM and Embedding provider.
"""
import json
from typing import Generator, Optional

from .base import (
    LLMProvider,
    LLMResponse,
    EmbeddingProvider,
    ProviderConfig,
    ProviderType,
    EmbeddingProviderType,
)


class OpenAIProvider(LLMProvider):
    """OpenAI GPT provider."""
    
    provider_type = ProviderType.OPENAI
    
    DEFAULT_MODELS = [
        "gpt-5.4-mini",
        "gpt-5.4",
        "gpt-5",
    ]
    
    def __init__(self, config: ProviderConfig):
        if not config.base_url:
            config.base_url = "https://api.openai.com/v1"
        if not config.model:
            config.model = "gpt-5.4-mini"
        super().__init__(config)
        self._client: Optional[any] = None
    
    def _validate_config(self) -> None:
        """Validate OpenAI API key is provided."""
        # API key can be None during initialization, validated on use
        pass
    
    def _get_client(self):
        """Lazy load OpenAI client."""
        if self._client is None:
            try:
                from openai import OpenAI
                self._client = OpenAI(
                    api_key=self.config.api_key,
                    base_url=self.config.base_url if self.config.base_url != "https://api.openai.com/v1" else None
                )
            except ImportError:
                raise RuntimeError("openai package not installed. Run: pip install openai")
        return self._client
    
    def generate(self, prompt: str, **kwargs) -> LLMResponse:
        """Generate a response."""
        if not self.config.api_key:
            raise RuntimeError("OpenAI API key not configured")
        
        client = self._get_client()
        
        try:
            response = client.chat.completions.create(
                model=self.config.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=kwargs.get("temperature", self.config.temperature),
                max_tokens=kwargs.get("max_tokens", self.config.max_tokens),
            )
            
            choice = response.choices[0]
            return LLMResponse(
                content=choice.message.content or "",
                model=self.config.model,
                provider="openai",
                tokens_used=response.usage.total_tokens if response.usage else 0,
                finish_reason=choice.finish_reason or "stop",
                metadata={
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                    "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                }
            )
        except Exception as e:
            raise RuntimeError(f"OpenAI request failed: {e}")
    
    def generate_stream(self, prompt: str, **kwargs) -> Generator[str, None, None]:
        """Stream response tokens."""
        if not self.config.api_key:
            raise RuntimeError("OpenAI API key not configured")
        
        client = self._get_client()
        
        try:
            stream = client.chat.completions.create(
                model=self.config.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=kwargs.get("temperature", self.config.temperature),
                max_tokens=kwargs.get("max_tokens", self.config.max_tokens),
                stream=True,
            )
            
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
                    
        except Exception as e:
            raise RuntimeError(f"OpenAI streaming failed: {e}")
    
    def list_models(self) -> list[str]:
        """List available OpenAI models."""
        if not self.config.api_key:
            return self.DEFAULT_MODELS
        
        try:
            client = self._get_client()
            models = client.models.list()
            # Filter to chat models
            chat_models = [
                m.id for m in models.data 
                if "gpt" in m.id.lower() and "instruct" not in m.id.lower()
            ]
            return sorted(chat_models) if chat_models else self.DEFAULT_MODELS
        except Exception:
            return self.DEFAULT_MODELS
    
    def is_available(self) -> bool:
        """Check if OpenAI is configured."""
        return bool(self.config.api_key)


class OpenAIEmbeddingProvider(EmbeddingProvider):
    """OpenAI embedding provider."""
    
    provider_type = EmbeddingProviderType.OPENAI
    
    EMBEDDING_MODELS = {
        "text-embedding-3-small": 1536,
        "text-embedding-3-large": 3072,
        "text-embedding-ada-002": 1536,
    }
    DEFAULT_MODEL = "text-embedding-3-small"
    
    def __init__(self, config: ProviderConfig):
        if not config.model:
            config.model = self.DEFAULT_MODEL
        super().__init__(config)
        self._client: Optional[any] = None
    
    def _get_client(self):
        """Lazy load OpenAI client."""
        if self._client is None:
            try:
                from openai import OpenAI
                self._client = OpenAI(api_key=self.config.api_key)
            except ImportError:
                raise RuntimeError("openai package not installed. Run: pip install openai")
        return self._client
    
    def embed_text(self, text: str) -> list[float]:
        """Generate embedding for text."""
        if not self.config.api_key:
            raise RuntimeError("OpenAI API key not configured")
        
        client = self._get_client()
        
        try:
            response = client.embeddings.create(
                model=self.config.model,
                input=text
            )
            return response.data[0].embedding
        except Exception as e:
            raise RuntimeError(f"OpenAI embedding failed: {e}")
    
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts (batched)."""
        if not self.config.api_key:
            raise RuntimeError("OpenAI API key not configured")
        
        if not texts:
            return []
        
        client = self._get_client()
        
        try:
            response = client.embeddings.create(
                model=self.config.model,
                input=texts
            )
            # Sort by index to maintain order
            sorted_data = sorted(response.data, key=lambda x: x.index)
            return [item.embedding for item in sorted_data]
        except Exception as e:
            raise RuntimeError(f"OpenAI batch embedding failed: {e}")
    
    def get_embedding_dimension(self) -> int:
        """Get embedding dimension for current model."""
        return self.EMBEDDING_MODELS.get(self.config.model, 1536)
    
    def is_available(self) -> bool:
        """Check if OpenAI embeddings are configured."""
        return bool(self.config.api_key)
    
    def list_embedding_models(self) -> list[str]:
        """List available embedding models."""
        return list(self.EMBEDDING_MODELS.keys())
