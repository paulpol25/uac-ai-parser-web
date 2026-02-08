"""
Anthropic Claude LLM provider.
"""
from typing import Generator, Optional

from .base import (
    LLMProvider,
    LLMResponse,
    ProviderConfig,
    ProviderType,
)


class ClaudeProvider(LLMProvider):
    """Anthropic Claude provider."""
    
    provider_type = ProviderType.CLAUDE
    
    DEFAULT_MODELS = [
        "claude-sonnet-4-20250514",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
        "claude-3-haiku-20240307",
    ]
    
    def __init__(self, config: ProviderConfig):
        if not config.model:
            config.model = "claude-3-5-sonnet-20241022"
        super().__init__(config)
        self._client: Optional[any] = None
    
    def _validate_config(self) -> None:
        """Validate Claude API key is provided."""
        pass
    
    def _get_client(self):
        """Lazy load Anthropic client."""
        if self._client is None:
            try:
                from anthropic import Anthropic
                self._client = Anthropic(api_key=self.config.api_key)
            except ImportError:
                raise RuntimeError("anthropic package not installed. Run: pip install anthropic")
        return self._client
    
    def generate(self, prompt: str, **kwargs) -> LLMResponse:
        """Generate a response."""
        if not self.config.api_key:
            raise RuntimeError("Claude API key not configured")
        
        client = self._get_client()
        
        try:
            response = client.messages.create(
                model=self.config.model,
                max_tokens=kwargs.get("max_tokens", self.config.max_tokens),
                messages=[{"role": "user", "content": prompt}],
                temperature=kwargs.get("temperature", self.config.temperature),
            )
            
            return LLMResponse(
                content=response.content[0].text if response.content else "",
                model=self.config.model,
                provider="claude",
                tokens_used=response.usage.input_tokens + response.usage.output_tokens if response.usage else 0,
                finish_reason=response.stop_reason or "stop",
                metadata={
                    "input_tokens": response.usage.input_tokens if response.usage else 0,
                    "output_tokens": response.usage.output_tokens if response.usage else 0,
                }
            )
        except Exception as e:
            raise RuntimeError(f"Claude request failed: {e}")
    
    def generate_stream(self, prompt: str, **kwargs) -> Generator[str, None, None]:
        """Stream response tokens."""
        if not self.config.api_key:
            raise RuntimeError("Claude API key not configured")
        
        client = self._get_client()
        
        try:
            with client.messages.stream(
                model=self.config.model,
                max_tokens=kwargs.get("max_tokens", self.config.max_tokens),
                messages=[{"role": "user", "content": prompt}],
                temperature=kwargs.get("temperature", self.config.temperature),
            ) as stream:
                for text in stream.text_stream:
                    yield text
                    
        except Exception as e:
            raise RuntimeError(f"Claude streaming failed: {e}")
    
    def list_models(self) -> list[str]:
        """List available Claude models."""
        # Anthropic doesn't have a list models endpoint, return defaults
        return self.DEFAULT_MODELS
    
    def is_available(self) -> bool:
        """Check if Claude is configured."""
        return bool(self.config.api_key)
