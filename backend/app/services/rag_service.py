import os
import shutil
from typing import List, AsyncGenerator, Dict, Any
from fastapi import UploadFile

from langchain_community.document_loaders import PyMuPDFLoader, CSVLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_ollama import ChatOllama

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage
from langchain_classic.chains import create_history_aware_retriever, create_retrieval_chain
from langchain_classic.chains.combine_documents import create_stuff_documents_chain

from app.core.config import settings

# Global initialization
embeddings = HuggingFaceEmbeddings(model_name=settings.EMBEDDING_MODEL)
llm = ChatOllama(model=settings.LLM_MODEL, base_url=settings.OLLAMA_BASE_URL)

contextualize_q_system_prompt = (
    "Given a chat history and the latest user question "
    "which might reference context in the chat history, "
    "formulate a standalone question which can be understood "
    "without the chat history. Do NOT answer the question, "
    "just reformulate it if needed and otherwise return it as is."
)
contextualize_q_prompt = ChatPromptTemplate.from_messages(
    [
        ("system", contextualize_q_system_prompt),
        MessagesPlaceholder("chat_history"),
        ("human", "{input}"),
    ]
)

qa_system_prompt = """
You are a highly capable Healthcare AI Assistant. 
You must answer the user's question based strictly on the provided context from hospital documents and SOPs.

Context:
{context}

Instructions:
1. Base your answer ONLY on the context provided above.
2. If the answer is not contained in the context, say exactly: "I could not find this information in the uploaded documents."
3. Do NOT invent, guess, or hallucinate any information.
4. If you find the answer, cite the source document name if it is available in the context.
5. Format your response beautifully using Markdown. Use bullet points, bold text for emphasis, and structure the information clearly so it is easy to read. DO NOT output raw unformatted data like CSV strings; always convert it into a readable sentence or list.
"""
qa_prompt = ChatPromptTemplate.from_messages(
    [
        ("system", qa_system_prompt),
        MessagesPlaceholder("chat_history"),
        ("human", "{input}"),
    ]
)

def get_chroma_db():
    return Chroma(
        persist_directory=settings.CHROMA_DB_DIR, 
        embedding_function=embeddings
    )

def process_and_store_document(file_path: str, filename: str):
    # 1. Load document
    if file_path.endswith('.pdf'):
        loader = PyMuPDFLoader(file_path)
    elif file_path.endswith('.csv'):
        loader = CSVLoader(file_path)
    else:
        raise ValueError("Unsupported file type")
    
    docs = loader.load()
    
    # Add original filename to metadata for citation
    for doc in docs:
        doc.metadata['source'] = filename

    # 2. Chunk document
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        separators=["\n\n", "\n", ".", " ", ""]
    )
    chunks = text_splitter.split_documents(docs)

    # 3. Store in ChromaDB
    db = get_chroma_db()
    db.add_documents(chunks)
    
    return len(chunks)

async def ask_question_stream(question: str, history: List[Dict[str, str]] = None) -> AsyncGenerator[str, None]:
    if history is None:
        history = []
        
    chat_history = []
    for msg in history:
        if msg.get("role") == "user":
            chat_history.append(HumanMessage(content=msg.get("content", "")))
        elif msg.get("role") == "assistant":
            chat_history.append(AIMessage(content=msg.get("content", "")))

    db = get_chroma_db()
    retriever = db.as_retriever(search_kwargs={"k": 4})
    
    history_aware_retriever = create_history_aware_retriever(
        llm, retriever, contextualize_q_prompt
    )
    
    question_answer_chain = create_stuff_documents_chain(llm, qa_prompt)
    rag_chain = create_retrieval_chain(history_aware_retriever, question_answer_chain)
    
    async for chunk in rag_chain.astream({"input": question, "chat_history": chat_history}):
        if answer_chunk := chunk.get("answer"):
            yield answer_chunk

def clear_database():
    """Wipes the ChromaDB database completely."""
    if os.path.exists(settings.CHROMA_DB_DIR):
        shutil.rmtree(settings.CHROMA_DB_DIR)
        os.makedirs(settings.CHROMA_DB_DIR)
