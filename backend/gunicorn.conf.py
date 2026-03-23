"""Gunicorn configuration — ensures forked workers get clean DB connections."""


def post_fork(server, worker):
    """Dispose inherited DB connections after fork so each worker creates its own."""
    from app.models import db

    db.engine.dispose()
