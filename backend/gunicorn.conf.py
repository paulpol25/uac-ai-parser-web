"""Gunicorn configuration — ensures forked workers get clean DB connections."""


def post_fork(server, worker):
    """Dispose inherited DB connections after fork so each worker creates its own."""
    from run import _flask_app
    from app.models import db

    with _flask_app.app_context():
        db.engine.dispose()
