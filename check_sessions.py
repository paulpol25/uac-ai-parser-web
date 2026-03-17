import sys
sys.path.insert(0, "/app/backend")
from app import create_app
app = create_app("production")
with app.app_context():
    from app.models import db, Session
    sessions = Session.query.all()
    for s in sessions:
        print(f"id={s.id} sid={s.session_id} status={s.status} err={s.error_message}")
    if not sessions:
        print("No sessions found")
