"""
UAC AI Parser - Flask Backend Configuration

Environment-specific configuration classes using the app factory pattern.
"""
import os
from pathlib import Path


class BaseConfig:
    """Base configuration with shared settings."""
    
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-in-production")
    
    # Database settings
    BASE_DIR = Path(__file__).parent
    DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", "~/.uac-ai/uac-ai.db")).expanduser()
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{DATABASE_PATH}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # SQLite-specific settings for better concurrency
    SQLALCHEMY_ENGINE_OPTIONS = {
        "connect_args": {
            "timeout": 30,  # Wait up to 30 seconds for locked database
            "check_same_thread": False,  # Allow multi-threaded access
        },
        "pool_pre_ping": True,  # Verify connections before use
    }
    
    # Upload settings
    MAX_CONTENT_LENGTH = 2 * 1024 * 1024 * 1024  # 2GB max upload
    UPLOAD_FOLDER = Path(os.environ.get("UPLOAD_FOLDER", "~/.uac-ai/uploads")).expanduser()
    ALLOWED_EXTENSIONS = {"tar.gz", "tgz", "zip"}
    
    # Ollama settings
    OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1")
    
    # ChromaDB settings (Tier 2 - Vector Index)
    CHROMA_PERSIST_DIR = Path(os.environ.get("CHROMA_PERSIST_DIR", "~/.uac-ai/chroma")).expanduser()
    
    # RAG settings (following RAG_DESIGN.md)
    RAG_CHUNK_SIZE = 512  # tokens, not characters
    RAG_CHUNK_OVERLAP = 50  # tokens
    RAG_TOP_K = 5  # Default top-k for retrieval
    RAG_HOT_CACHE_SIZE = 1000  # Max chunks in hot cache
    RAG_HOT_CACHE_TTL = 3600  # 1 hour TTL
    
    # CORS settings
    CORS_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]


class DevelopmentConfig(BaseConfig):
    """Development configuration."""
    
    DEBUG = True
    TESTING = False


class TestingConfig(BaseConfig):
    """Testing configuration."""
    
    DEBUG = False
    TESTING = True
    UPLOAD_FOLDER = Path("./test_uploads")


class ProductionConfig(BaseConfig):
    """Production configuration."""
    
    DEBUG = False
    TESTING = False
    SECRET_KEY = os.environ.get("SECRET_KEY", None)  # Must be set in production
    CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "").split(",") if os.environ.get("CORS_ORIGINS") else ["http://localhost:3000"]
    
    def __init__(self):
        if self.SECRET_KEY is None:
            raise ValueError("SECRET_KEY environment variable is required in production")


config_by_name = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
}
