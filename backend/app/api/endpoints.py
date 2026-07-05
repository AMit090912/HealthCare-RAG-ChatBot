import os
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Optional

from app.core.config import settings
from app.services.rag_service import process_and_store_document, ask_question_stream, clear_database

router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[Dict[str, str]]] = []

class ChatResponse(BaseModel):
    response: str

@router.post("/upload")
async def upload_documents(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    
    total_chunks = 0
    saved_files = []
    
    for file in files:
        if not (file.filename.endswith('.pdf') or file.filename.endswith('.csv')):
            raise HTTPException(status_code=400, detail=f"File {file.filename} is not a PDF or CSV")
        
        file_path = os.path.join(settings.DATA_DIR, file.filename)
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        try:
            chunks_created = process_and_store_document(file_path, file.filename)
            total_chunks += chunks_created
            saved_files.append(file.filename)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to process {file.filename}: {str(e)}")
            
    return {
        "message": "Documents uploaded and indexed successfully",
        "files_processed": saved_files,
        "total_chunks_created": total_chunks
    }

@router.post("/chat")
async def chat_endpoint(request: ChatRequest):
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    # Return a StreamingResponse using Server-Sent Events (SSE) or simple chunks
    async def event_generator():
        try:
            async for chunk in ask_question_stream(request.message, request.history):
                yield chunk
        except Exception as e:
            yield f"\n[Error: {str(e)}]"

    return StreamingResponse(event_generator(), media_type="text/plain")

@router.post("/clear")
def clear_db():
    try:
        clear_database()
        # Also clear the data directory
        for f in os.listdir(settings.DATA_DIR):
            os.remove(os.path.join(settings.DATA_DIR, f))
        return {"message": "Database and uploaded files cleared successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
