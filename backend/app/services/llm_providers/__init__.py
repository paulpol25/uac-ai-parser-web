"""
LLM Provider abstraction layer.

Supports multiple LLM backends:
- Ollama (local)
- OpenAI (GPT-4, GPT-3.5)
- Google Gemini
- Anthropic Claude
"""
from .base import LLMProvider, LLMResponse, EmbeddingProvider
from .ollama_provider import OllamaProvider
from .openai_provider import OpenAIProvider
from .gemini_provider import GeminiProvider
from .claude_provider import ClaudeProvider
from .provider_factory import ProviderFactory, get_provider, get_embedding_provider

__all__ = [
    "LLMProvider",
    "LLMResponse",
    "EmbeddingProvider",
    "OllamaProvider",
    "OpenAIProvider",
    "GeminiProvider",
    "ClaudeProvider",
    "ProviderFactory",
    "get_provider",
    "get_embedding_provider",
]
