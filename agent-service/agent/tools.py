"""Tool definitions and schemas for SageSearch Autonomous Agent."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class SearchFilesParams(BaseModel):
    query: str = Field(description="Search keywords, natural language query, or file descriptions")
    file_types: Optional[List[str]] = Field(default=None, description="Filter by file extensions, e.g. ['pdf', 'png', 'jpg', 'docx', 'csv']")
    date_range: Optional[str] = Field(default=None, description="Optional date filter e.g. 'last_month', 'last_30_days', '2026-07'")
    max_results: int = Field(default=20, description="Maximum number of file search results to return")


class ReadFileContentParams(BaseModel):
    path: str = Field(description="Absolute or relative file path to read")
    max_chars: int = Field(default=8000, description="Maximum number of characters to read from the file")


class ExtractFieldsParams(BaseModel):
    content: str = Field(description="Raw text or document content to extract fields from")
    fields: List[str] = Field(description="List of fields to extract, e.g. ['merchant', 'date', 'amount', 'category']")
    instructions: Optional[str] = Field(default=None, description="Specific extraction instructions or format hints")


class AskUserParams(BaseModel):
    question: str = Field(description="Clarification question or approval prompt for the user")
    options: Optional[List[str]] = Field(default=None, description="Optional selectable choices, e.g. ['Approve', 'Edit', 'Cancel']")
    preview_data: Optional[Dict[str, Any]] = Field(default=None, description="Structured preview data or table rows to show the user")


class CreateArtifactParams(BaseModel):
    filename: str = Field(description="Target filename or relative path to save, e.g. 'expense_report_july_2026.csv'")
    content_type: str = Field(description="MIME type or format identifier, e.g. 'text/csv', 'text/markdown', 'application/json'")
    data: str = Field(description="Raw string content or CSV text to write to the file")


# Dictionary-based Tool Declarations (OpenAPI / Google GenAI Schema)
TOOL_DECLARATIONS = [
    {
        "name": "search_files",
        "description": "Searches the local filesystem index for files matching keywords, file types, and date ranges.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {
                    "type": "STRING",
                    "description": "Search query keywords or semantic descriptions (e.g. 'receipt', 'gym invoice', 'flight ticket')."
                },
                "file_types": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                    "description": "List of file extensions to filter by, e.g. ['pdf', 'png', 'jpg', 'docx', 'csv']."
                },
                "date_range": {
                    "type": "STRING",
                    "description": "Optional date filter e.g. 'last_month', 'last_7_days', '2026-07'."
                },
                "max_results": {
                    "type": "INTEGER",
                    "description": "Max number of results to return (default: 20)."
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "read_file_content",
        "description": "Reads text and extracted content from a specific local file identified in search results.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "path": {
                    "type": "STRING",
                    "description": "File path to read."
                },
                "max_chars": {
                    "type": "INTEGER",
                    "description": "Maximum number of characters to return (default: 8000)."
                }
            },
            "required": ["path"]
        }
    },
    {
        "name": "extract_fields",
        "description": "Extracts structured key-value data (e.g. merchant, total amount, transaction date, category) from document text.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "content": {
                    "type": "STRING",
                    "description": "Raw text content of the document."
                },
                "fields": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                    "description": "List of field names to extract, e.g. ['merchant', 'date', 'amount', 'category']."
                },
                "instructions": {
                    "type": "STRING",
                    "description": "Optional extraction guidelines or notes."
                }
            },
            "required": ["content", "fields"]
        }
    },
    {
        "name": "ask_user",
        "description": "Presents an interactive prompt or structured data preview table to the user for approval or clarification.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "question": {
                    "type": "STRING",
                    "description": "The prompt or approval request message for the user."
                },
                "options": {
                    "type": "ARRAY",
                    "items": {"type": "STRING"},
                    "description": "Selectable options e.g. ['Approve', 'Edit', 'Cancel']."
                },
                "preview_data": {
                    "type": "OBJECT",
                    "description": "Optional structured table rows or summary data for visual preview."
                }
            },
            "required": ["question"]
        }
    },
    {
        "name": "create_artifact",
        "description": "Saves a generated artifact (e.g., CSV spreadsheet, Markdown summary, or JSON report) to the user's local workspace.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "filename": {
                    "type": "STRING",
                    "description": "Name of the output file, e.g. 'expense_report_july_2026.csv'."
                },
                "content_type": {
                    "type": "STRING",
                    "description": "File MIME type, e.g. 'text/csv' or 'text/markdown'."
                },
                "data": {
                    "type": "STRING",
                    "description": "The text or tabular data to write to the file."
                }
            },
            "required": ["filename", "content_type", "data"]
        }
    }
]
