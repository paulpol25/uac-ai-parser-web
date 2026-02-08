"""
Google Gemini LLM provider.
"""
from typing import Generator, Optional

from .base import (
    LLMProvider,
    LLMResponse,
    ProviderConfig,
    ProviderType,
)


class GeminiProvider(LLMProvider):
    """Google Gemini provider."""
    
    provider_type = ProviderType.GEMINI
    
    DEFAULT_MODELS = [
        "gemini-2.0-flash-exp",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
        "gemini-1.5-flash-8b",
        "gemini-1.0-pro",
    ]
    
    def __init__(self, config: ProviderConfig):
        if not config.model:
            config.model = "gemini-1.5-flash"
        super().__init__(config)
        self._client: Optional[any] = None
        self._model_instance: Optional[any] = None
    
    def _validate_config(self) -> None:
        """Validate Gemini API key is provided."""
        pass
    
    def _get_client(self):
        """Lazy load Gemini client."""
        if self._client is None:
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.config.api_key)
                self._client = genai
                self._model_instance = genai.GenerativeModel(
                    self.config.model,
                    generation_config=genai.GenerationConfig(
                        temperature=self.config.temperature,
                        max_output_tokens=self.config.max_tokens,
                    )
                )
            except ImportError:
                raise RuntimeError("google-generativeai package not installed. Run: pip install google-generativeai")
        return self._client
    
    def _get_model(self):
        """Get or create model instance."""
        if self._model_instance is None or self._model_instance.model_name != f"models/{self.config.model}":
            self._get_client()
            import google.generativeai as genai
            self._model_instance = genai.GenerativeModel(
                self.config.model,
                generation_config=genai.GenerationConfig(
                    temperature=self.config.temperature,
                    max_output_tokens=self.config.max_tokens,
                )
            )
        return self._model_instance
    
    def generate(self, prompt: str, **kwargs) -> LLMResponse:
        """Generate a response."""
        if not self.config.api_key:
            raise RuntimeError("Gemini API key not configured")
        
        model = self._get_model()
        
        try:
            response = model.generate_content(prompt)
            
            return LLMResponse(
                content=response.text if response.text else "",
                model=self.config.model,
                provider="gemini",
                tokens_used=0,  # Gemini doesn't expose token count easily
                finish_reason=response.candidates[0].finish_reason.name if response.candidates else "stop",
                metadata={}
            )
        except Exception as e:
            raise RuntimeError(f"Gemini request failed: {e}")
    
    def generate_stream(self, prompt: str, **kwargs) -> Generator[str, None, None]:
        """Stream response tokens."""
        if not self.config.api_key:
            raise RuntimeError("Gemini API key not configured")
        
        model = self._get_model()
        
        try:
            response = model.generate_content(prompt, stream=True)
            
            for chunk in response:
                if chunk.text:
                    yield chunk.text
                    
        except Exception as e:
            raise RuntimeError(f"Gemini streaming failed: {e}")
    
    def list_models(self) -> list[str]:
        """List available Gemini models."""
        if not self.config.api_key:
            return self.DEFAULT_MODELS
        
        try:
            client = self._get_client()
            models = []
            for model in client.list_models():
                if "generateContent" in model.supported_generation_methods:
                    # Extract just model name without "models/" prefix
                    name = model.name.replace("models/", "")
                    if "gemini" in name.lower():
                        models.append(name)
            return sorted(models) if models else self.DEFAULT_MODELS
        except Exception:
            return self.DEFAULT_MODELS
    
    def is_available(self) -> bool:
        """Check if Gemini is configured."""
        return bool(self.config.api_key)
