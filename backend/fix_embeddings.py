"""Script to generate embeddings for session chunks."""
import chromadb
from pathlib import Path
from app import create_app
from app.models import db, Session, Chunk

app = create_app()
app.config['CHROMA_PERSIST_DIR'] = Path.home() / '.uac-ai' / 'chroma'

with app.app_context():
    session = Session.query.filter_by(session_id='e85b977b-99f7-45eb-9ee7-4d1af031759b').first()
    chunks = Chunk.query.filter_by(session_id=session.id).all()
    
    print(f'Found {len(chunks)} chunks to embed')
    
    # Get ChromaDB collection
    client = chromadb.PersistentClient(path=str(app.config['CHROMA_PERSIST_DIR']))
    collection_name = f"session_{session.session_id.replace('-', '_')}"
    collection = client.get_or_create_collection(name=collection_name)
    
    print(f'Collection: {collection_name}')
    print('Starting batch upsert (ChromaDB will generate embeddings)...')
    
    # Batch upsert
    BATCH_SIZE = 100
    for i in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[i:i + BATCH_SIZE]
        collection.upsert(
            ids=[c.chunk_id for c in batch],
            documents=[c.content for c in batch],
            metadatas=[{
                'source_file': c.source_file,
                'source_type': c.source_type,
                'artifact_category': c.artifact_category or 'other',
                'importance_score': c.importance_score or 0.0
            } for c in batch]
        )
        if (i // BATCH_SIZE + 1) % 10 == 0:
            print(f'  Processed {i + BATCH_SIZE} chunks...')
    
    print(f'Done! Collection now has {collection.count()} entries')
