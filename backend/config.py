"""
UAC AI Parser - Flask Backend Configuration

Environment-specific configuration classes using the app factory pattern.
"""
import os
from pathlib import Path


class BaseConfig:
    """Base configuration with shared settings."""
    
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-in-production")
    
    # Database — PostgreSQL (primary), SQLite (fallback for local dev)
    DATABASE_URL = os.environ.get("DATABASE_URL", "")
    DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", "~/.uac-ai/uac-ai.db")).expanduser()
    
    SQLALCHEMY_DATABASE_URI = DATABASE_URL if DATABASE_URL else f"sqlite:///{DATABASE_PATH}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Engine options: PostgreSQL pool vs SQLite pragmas
    _db_url = os.environ.get("DATABASE_URL", "")
    SQLALCHEMY_ENGINE_OPTIONS = (
        {
            "pool_pre_ping": True,
            "pool_size": 10,
            "max_overflow": 20,
            "pool_recycle": 300,
        }
        if _db_url
        else {
            "connect_args": {
                "timeout": 30,
                "check_same_thread": False,
            },
            "pool_pre_ping": True,
        }
    )
    
    # Redis (caching)
    REDIS_URL = os.environ.get("REDIS_URL", "")
    
    # Upload settings
    MAX_CONTENT_LENGTH = 2 * 1024 * 1024 * 1024  # 2GB max upload
    UPLOAD_FOLDER = Path(os.environ.get("UPLOAD_FOLDER", "~/.uac-ai/uploads")).expanduser()
    ALLOWED_EXTENSIONS = {"tar.gz", "tgz", "zip"}
    
    # Ollama (local LLM)
    OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1")
    
    # ChromaDB (vector embeddings)
    CHROMA_PERSIST_DIR = Path(os.environ.get("CHROMA_PERSIST_DIR", "~/.uac-ai/chroma")).expanduser()
    
    # RAG settings
    RAG_CHUNK_SIZE = 512       # tokens
    RAG_CHUNK_OVERLAP = 50     # tokens
    RAG_HOT_CACHE_SIZE = 1000  # max chunks in hot cache
    
    # CORS
    CORS_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
    
    # Authentication provider: 'supabase' or 'local'
    AUTH_PROVIDER = os.environ.get("AUTH_PROVIDER", "local")
    
    # Supabase (only needed when AUTH_PROVIDER=supabase)
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
    SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
    
    # Cleanup
    DATA_RETENTION_DAYS = int(os.environ.get("DATA_RETENTION_DAYS", "90"))  # 0 = never auto-delete
    CLEANUP_EXTRACTED_AFTER_PARSE = os.environ.get("CLEANUP_EXTRACTED_AFTER_PARSE", "true").lower() == "true"
    MAX_STORAGE_GB = float(os.environ.get("MAX_STORAGE_GB", "50"))


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
