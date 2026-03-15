"""
Authentication provider factory.

Supports dual auth:
- 'supabase' (default): Uses Supabase for auth, syncs users to local DB
- 'local': Traditional username/password with DB-backed tokens
"""
import os
import logging

logger = logging.getLogger(__name__)

_provider_instance = None


def get_auth_provider():
    """Get the configured auth provider (singleton)."""
    global _provider_instance
    if _provider_instance is None:
        provider_name = os.environ.get("AUTH_PROVIDER", "local").lower()
        
        if provider_name == "supabase":
            supabase_url = os.environ.get("SUPABASE_URL")
            supabase_key = os.environ.get("SUPABASE_ANON_KEY")
            
            if not supabase_url or not supabase_key:
                logger.warning(
                    "AUTH_PROVIDER=supabase but SUPABASE_URL/SUPABASE_ANON_KEY not set. "
                    "Falling back to local auth."
                )
                provider_name = "local"
            else:
                try:
                    from .supabase_provider import SupabaseAuthProvider
                    _provider_instance = SupabaseAuthProvider(supabase_url, supabase_key)
                    logger.info("Using Supabase authentication provider")
                    return _provider_instance
                except ImportError:
                    logger.warning(
                        "supabase package not installed. Falling back to local auth. "
                        "Install with: pip install supabase"
                    )
                    provider_name = "local"
        
        if provider_name == "local":
            from .local_provider import LocalAuthProvider
            _provider_instance = LocalAuthProvider()
            logger.info("Using local authentication provider")
    
    return _provider_instance


def get_provider_name() -> str:
    """Get the name of the active auth provider."""
    provider = get_auth_provider()
    return provider.provider_name if provider else "local"


def reset_provider():
    """Reset the cached provider instance (for testing)."""
    global _provider_instance
    _provider_instance = None
