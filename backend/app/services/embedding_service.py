"""
Fast embedding service using sentence-transformers with GPU acceleration.

This service provides fast, GPU-accelerated embeddings for document chunks
and queries, replacing ChromaDB's default slow CPU-based embedding.

Key performance improvements:
- Configurable model (default: bge-small for speed, bge-base for quality)
- Batch processing with configurable batch size
- GPU acceleration when available (CUDA)
- Thread-safe singleton pattern

Settings (from ~/.uac-ai/settings.json or env vars):
- embedding_model: Model name (default: BAAI/bge-small-en-v1.5)
  Options:
    - BAAI/bge-small-en-v1.5 (384 dim, fast, good quality) - DEFAULT
    - BAAI/bge-base-en-v1.5 (768 dim, slower, best quality)
    - all-MiniLM-L6-v2 (384 dim, fastest, decent quality)
    - nomic-ai/nomic-embed-text-v1.5 (768 dim, good quality, Apache 2.0)
"""

import logging
import os
import json
from pathlib import Path
from typing import Optional
import numpy as np

logger = logging.getLogger(__name__)

# Settings file path
SETTINGS_FILE = Path.home() / '.uac-ai' / 'settings.json'

# Model options with their dimensions and descriptions
EMBEDDING_MODELS = {
    "BAAI/bge-small-en-v1.5": {
        "dimension": 384,
        "name": "BGE Small",
        "description": "Fast, good quality (DEFAULT)",
        "type": "sentence-transformers"
    },
    "BAAI/bge-base-en-v1.5": {
        "dimension": 768,
        "name": "BGE Base", 
        "description": "Best quality, slower",
        "type": "sentence-transformers"
    },
    "all-MiniLM-L6-v2": {
        "dimension": 384,
        "name": "MiniLM",
        "description": "Fastest, decent quality",
        "type": "sentence-transformers"
    },
    "nomic-ai/nomic-embed-text-v1.5": {
        "dimension": 768,
        "name": "Nomic Embed",
        "description": "Good quality, Apache 2.0 license",
        "type": "sentence-transformers"
    },
}

DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"


def _get_embedding_settings() -> dict:
    """Get embedding settings from settings file or defaults."""
    defaults = {
        "embedding_model": DEFAULT_MODEL,
    }
    
    # Check environment variable first
    env_model = os.environ.get("EMBEDDING_MODEL")
    if env_model:
        defaults["embedding_model"] = env_model
        return defaults
    
    # Then check settings file
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, 'r') as f:
                saved = json.load(f)
                processing = saved.get("processing", {})
                if "embedding_model" in processing:
                    defaults["embedding_model"] = processing["embedding_model"]
        except Exception:
            pass
    
    return defaults


class EmbeddingService:
    """
    Singleton embedding service using sentence-transformers.
    
    Provides ~10-20x faster embeddings compared to ChromaDB's default
    when using GPU acceleration.
    """
    
    _instance: Optional["EmbeddingService"] = None
    _model = None
    _model_name: str = None
    _device: str = None
    _initialized = False
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        """Initialize the embedding model lazily."""
        if EmbeddingService._initialized:
            return
        EmbeddingService._initialized = True
        self._load_model()
    
    def _load_model(self):
        """Load the sentence transformer model."""
        try:
            from sentence_transformers import SentenceTransformer
            import torch
            
            # Get model from settings file or environment
            settings = _get_embedding_settings()
            EmbeddingService._model_name = settings["embedding_model"]
            
            # Validate model
            if EmbeddingService._model_name not in EMBEDDING_MODELS:
                logger.warning(f"Unknown model {EmbeddingService._model_name}, using default")
                EmbeddingService._model_name = DEFAULT_MODEL
            
            # Determine device - force CUDA if available
            if torch.cuda.is_available():
                EmbeddingService._device = "cuda"
                # Ensure CUDA is initialized
                torch.cuda.init()
                logger.info(f"🚀 CUDA available - using GPU for embeddings")
                logger.info(f"   GPU: {torch.cuda.get_device_name(0)}")
                logger.info(f"   VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
            else:
                EmbeddingService._device = "cpu"
                logger.info("⚠️ CUDA not available - using CPU for embeddings (slower)")
            
            model_info = EMBEDDING_MODELS.get(EmbeddingService._model_name, {})
            logger.info(f"📥 Loading embedding model: {EmbeddingService._model_name}")
            logger.info(f"   {model_info.get('name', 'Unknown')} - {model_info.get('description', '')}")
            
            # Special handling for nomic model (requires trust_remote_code)
            model_kwargs = {}
            if "nomic" in EmbeddingService._model_name.lower():
                model_kwargs["trust_remote_code"] = True
            
            EmbeddingService._model = SentenceTransformer(
                EmbeddingService._model_name,
                device=EmbeddingService._device,
                **model_kwargs
            )
            
            # Verify model is on correct device
            actual_device = next(EmbeddingService._model.parameters()).device
            logger.info(f"✅ Embedding model loaded on {actual_device} (dim={self.embedding_dimension})")
            
        except ImportError as e:
            logger.warning(f"sentence-transformers not installed: {e}")
            logger.warning("Falling back to ChromaDB default embeddings")
            EmbeddingService._model = None
        except Exception as e:
            logger.error(f"Failed to load embedding model: {e}")
            import traceback
            traceback.print_exc()
            EmbeddingService._model = None
    
    @classmethod
    def reload_model(cls):
        """Reload the model with current settings (call after changing settings)."""
        cls._initialized = False
        cls._model = None
        cls._instance = None
        return cls()
    
    @property
    def is_available(self) -> bool:
        """Check if the embedding service is available."""
        return EmbeddingService._model is not None
    
    @property
    def embedding_dimension(self) -> int:
        """Return the embedding dimension based on model."""
        if EmbeddingService._model_name in EMBEDDING_MODELS:
            return EMBEDDING_MODELS[EmbeddingService._model_name]["dimension"]
        return 768  # Default fallback
    
    @property
    def model_info(self) -> dict:
        """Return info about current model."""
        if EmbeddingService._model_name in EMBEDDING_MODELS:
            return {
                "id": EmbeddingService._model_name,
                **EMBEDDING_MODELS[EmbeddingService._model_name],
                "device": EmbeddingService._device
            }
        return {"id": EmbeddingService._model_name, "dimension": 768, "device": EmbeddingService._device}
    
    def embed_documents(
        self,
        documents: list[str],
        batch_size: int = 64,
        show_progress: bool = False,
        normalize: bool = True
    ) -> list[list[float]]:
        """
        Generate embeddings for a list of documents.
        
        Args:
            documents: List of text strings to embed
            batch_size: Batch size for processing (64 works well with 8GB VRAM)
            show_progress: Whether to show progress bar
            normalize: Whether to L2-normalize embeddings
            
        Returns:
            List of embeddings (each embedding is a list of floats)
        """
        if not self.is_available:
            raise RuntimeError(
                "Embedding service not available. "
                "Please install sentence-transformers."
            )
        
        if not documents:
            return []
        
        logger.debug(f"Embedding {len(documents)} documents (batch_size={batch_size})")
        
        # For bge models, prepend instruction for better performance
        # This significantly improves retrieval quality
        processed_docs = documents
        
        embeddings = EmbeddingService._model.encode(
            processed_docs,
            batch_size=batch_size,
            show_progress_bar=show_progress,
            normalize_embeddings=normalize,
            convert_to_numpy=True,
            device=EmbeddingService._device  # Explicitly use configured device
        )
        
        # Convert numpy array to list of lists for ChromaDB compatibility
        if isinstance(embeddings, np.ndarray):
            return embeddings.tolist()
        return embeddings
    
    def embed_query(self, query: str, normalize: bool = True) -> list[float]:
        """
        Generate embedding for a single query.
        
        For bge models, we prepend a query instruction for better retrieval.
        
        Args:
            query: Query text to embed
            normalize: Whether to L2-normalize the embedding
            
        Returns:
            Embedding as a list of floats
        """
        if not self.is_available:
            raise RuntimeError(
                "Embedding service not available. "
                "Please install sentence-transformers."
            )
        
        # For bge models, prepend query instruction for better retrieval
        # This is recommended by the model authors
        instruction = "Represent this sentence for searching relevant passages: "
        processed_query = instruction + query
        
        embedding = EmbeddingService._model.encode(
            processed_query,
            normalize_embeddings=normalize,
            convert_to_numpy=True,
            device=EmbeddingService._device  # Explicitly use configured device
        )
        
        if isinstance(embedding, np.ndarray):
            return embedding.tolist()
        return embedding


# Module-level functions for easy access
def get_embedding_service() -> EmbeddingService:
    """Get the singleton embedding service instance."""
    return EmbeddingService()


def list_embedding_models() -> list[dict]:
    """List all available embedding models with their info."""
    return [
        {
            "id": model_id,
            "name": info["name"],
            "description": info["description"],
            "dimension": info["dimension"],
        }
        for model_id, info in EMBEDDING_MODELS.items()
    ]


def get_current_embedding_info() -> dict:
    """Get info about the currently loaded embedding model."""
    svc = get_embedding_service()
    return {
        "model": EmbeddingService._model_name or DEFAULT_MODEL,
        "dimension": svc.embedding_dimension if svc.is_available else EMBEDDING_MODELS[DEFAULT_MODEL]["dimension"],
        "device": EmbeddingService._device or "unknown",
        "available": svc.is_available,
    }
