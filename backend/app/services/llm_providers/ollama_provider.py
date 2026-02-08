"""
Ollama LLM and Embedding provider.
"""
import requests
import json
from typing import Generator

from .base import (
    LLMProvider,
    LLMResponse,
    EmbeddingProvider,
    ProviderConfig,
    ProviderType,
    EmbeddingProviderType,
)


class OllamaProvider(LLMProvider):
    """Ollama local LLM provider."""
    
    provider_type = ProviderType.OLLAMA
    
    def __init__(self, config: ProviderConfig):
        if not config.base_url:
            config.base_url = "http://localhost:11434"
        if not config.model:
            config.model = "llama3.1"
        super().__init__(config)
    
    def _validate_config(self) -> None:
        """Ollama doesn't require API key."""
        pass
    
    def generate(self, prompt: str, **kwargs) -> LLMResponse:
        """Generate a response."""
        try:
            response = requests.post(
                f"{self.config.base_url}/api/generate",
                json={
                    "model": self.config.model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": kwargs.get("temperature", self.config.temperature),
                        "num_predict": kwargs.get("max_tokens", self.config.max_tokens),
                    }
                },
                timeout=300
            )
            response.raise_for_status()
            data = response.json()
            
            return LLMResponse(
                content=data.get("response", ""),
                model=self.config.model,
                provider="ollama",
                tokens_used=data.get("eval_count", 0),
                finish_reason=data.get("done_reason", "stop"),
                metadata={
                    "total_duration": data.get("total_duration"),
                    "load_duration": data.get("load_duration"),
                }
            )
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"Ollama request failed: {e}")
    
    def generate_stream(self, prompt: str, **kwargs) -> Generator[str, None, None]:
        """Stream response tokens."""
        try:
            response = requests.post(
                f"{self.config.base_url}/api/generate",
                json={
                    "model": self.config.model,
                    "prompt": prompt,
                    "stream": True,
                    "options": {
                        "temperature": kwargs.get("temperature", self.config.temperature),
                        "num_predict": kwargs.get("max_tokens", self.config.max_tokens),
                    }
                },
                stream=True,
                timeout=300
            )
            response.raise_for_status()
            
            for line in response.iter_lines():
                if line:
                    data = json.loads(line)
                    if "response" in data:
                        yield data["response"]
                    if data.get("done"):
                        break
                        
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"Ollama streaming failed: {e}")
    
    def list_models(self) -> list[str]:
        """List available Ollama models."""
        try:
            response = requests.get(
                f"{self.config.base_url}/api/tags",
                timeout=5
            )
            if response.status_code == 200:
                data = response.json()
                return [model["name"] for model in data.get("models", [])]
            return []
        except requests.exceptions.RequestException:
            return []
    
    def is_available(self) -> bool:
        """Check if Ollama is running."""
        try:
            response = requests.get(
                f"{self.config.base_url}/api/tags",
                timeout=5
            )
            return response.status_code == 200
        except requests.exceptions.RequestException:
            return False


class OllamaEmbeddingProvider(EmbeddingProvider):
    """Ollama embedding provider."""
    
    provider_type = EmbeddingProviderType.OLLAMA
    
    DEFAULT_MODEL = "nomic-embed-text"
    EMBEDDING_DIMENSIONS = {
        "nomic-embed-text": 768,
        "mxbai-embed-large": 1024,
        "all-minilm": 384,
    }
    
    def __init__(self, config: ProviderConfig):
        if not config.base_url:
            config.base_url = "http://localhost:11434"
        if not config.model:
            config.model = self.DEFAULT_MODEL
        super().__init__(config)
    
    def embed_text(self, text: str) -> list[float]:
        """Generate embedding for text."""
        try:
            response = requests.post(
                f"{self.config.base_url}/api/embeddings",
                json={
                    "model": self.config.model,
                    "prompt": text
                },
                timeout=30
            )
            response.raise_for_status()
            return response.json().get("embedding", [])
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"Ollama embedding failed: {e}")
    
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts."""
        return [self.embed_text(text) for text in texts]
    
    def get_embedding_dimension(self) -> int:
        """Get embedding dimension for current model."""
        return self.EMBEDDING_DIMENSIONS.get(self.config.model, 768)
    
    def is_available(self) -> bool:
        """Check if embedding model is available."""
        try:
            response = requests.get(
                f"{self.config.base_url}/api/tags",
                timeout=5
            )
            if response.status_code == 200:
                models = [m["name"] for m in response.json().get("models", [])]
                # Check if embedding model or base model exists
                return self.config.model in models or any(
                    self.config.model.split(":")[0] in m for m in models
                )
            return False
        except requests.exceptions.RequestException:
            return False
    
    def list_embedding_models(self) -> list[str]:
        """List models suitable for embeddings."""
        try:
            response = requests.get(
                f"{self.config.base_url}/api/tags",
                timeout=5
            )
            if response.status_code == 200:
                data = response.json()
                # Return models known to be good for embeddings
                all_models = [model["name"] for model in data.get("models", [])]
                embedding_models = []
                for model in all_models:
                    base_name = model.split(":")[0]
                    if base_name in self.EMBEDDING_DIMENSIONS or "embed" in base_name.lower():
                        embedding_models.append(model)
                return embedding_models if embedding_models else all_models[:5]
            return []
        except requests.exceptions.RequestException:
            return []
