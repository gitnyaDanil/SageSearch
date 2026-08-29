"""Mock and stub implementations for the 5 SageSearch agent tools."""
import os
from typing import Any, Dict, List, Optional

MOCK_FILES_DB = [
    {
        "path": "C:/Users/Daniel/Documents/Receipts/fit_gym_july.pdf",
        "name": "fit_gym_july.pdf",
        "extension": "pdf",
        "size": 142050,
        "modified": "2026-07-02T10:15:00Z",
        "content": (
            "FITNESS FIRST CLUB MEMBERSHIP\n"
            "Invoice #: FF-99214\n"
            "Date: 2026-07-02\n"
            "Member: Daniel\n"
            "Description: Monthly All-Access Gym Pass (July 2026)\n"
            "Subtotal: $75.00\n"
            "Tax: $6.00\n"
            "Total Paid: $81.00\n"
            "Payment Method: Visa ending in 4242\n"
        )
    },
    {
        "path": "C:/Users/Daniel/Documents/Receipts/delta_flight_nyc.pdf",
        "name": "delta_flight_nyc.pdf",
        "extension": "pdf",
        "size": 284100,
        "modified": "2026-07-14T08:30:00Z",
        "content": (
            "DELTA AIR LINES E-TICKET CONFIRMATION\n"
            "Confirmation Code: H7X9KP\n"
            "Issue Date: 2026-07-14\n"
            "Passenger: Daniel\n"
            "Flight: DL 402 SEA -> JFK\n"
            "Fare: $385.00\n"
            "Taxes & Fees: $38.50\n"
            "Total: $423.50 USD\n"
            "Status: Ticketed / Paid\n"
        )
    },
    {
        "path": "C:/Users/Daniel/Documents/Receipts/hilton_hotel_nyc.pdf",
        "name": "hilton_hotel_nyc.pdf",
        "extension": "pdf",
        "size": 195400,
        "modified": "2026-07-18T11:00:00Z",
        "content": (
            "HILTON GARDEN INN NYC\n"
            "Folio Number: 440981\n"
            "Check-In: 2026-07-15 | Check-Out: 2026-07-18 (3 Nights)\n"
            "Guest: Daniel\n"
            "Room Charges: $300.00\n"
            "City Tax: $43.00\n"
            "Total Amount Charged: $343.00\n"
            "Balance Due: $0.00\n"
        )
    },
    {
        "path": "C:/Users/Daniel/Documents/Receipts/uber_ride_july.pdf",
        "name": "uber_ride_july.pdf",
        "extension": "pdf",
        "size": 98200,
        "modified": "2026-07-16T19:45:00Z",
        "content": (
            "UBER TRIP RECEIPT\n"
            "Date: July 16, 2026\n"
            "Trip: JFK Airport to Manhattan Hotel\n"
            "Distance: 17.8 miles\n"
            "Trip Fare: $56.20\n"
            "Tolls & Tips: $12.00\n"
            "Total Charged: $68.20\n"
        )
    },
    {
        "path": "C:/Users/Daniel/Documents/Invoices/contractor_invoice_acme.pdf",
        "name": "contractor_invoice_acme.pdf",
        "extension": "pdf",
        "size": 156000,
        "modified": "2026-07-20T16:00:00Z",
        "content": (
            "ACME CONSULTING LLC\n"
            "Invoice #: INV-ACME-2026-08\n"
            "Date: 2026-07-20\n"
            "Due Date: 2026-08-05\n"
            "Contractor: Alex Rivera\n"
            "Services: Cloud Architecture Consulting (40 hrs)\n"
            "Hourly Rate: $125.00\n"
            "Total Balance Due: $5,000.00 USD\n"
        )
    },
    {
        "path": "C:/Users/Daniel/Documents/Work/project_spec_auth_v2.docx",
        "name": "project_spec_auth_v2.docx",
        "extension": "docx",
        "size": 512000,
        "modified": "2026-07-22T14:00:00Z",
        "content": (
            "PROJECT SPECIFICATION: User Authentication & SSO (v2.0)\n"
            "Author: Daniel\n"
            "Date: 2026-07-22\n"
            "Status: Approved\n"
            "Key Requirements:\n"
            "1. Support OAuth 2.0 and Google Sign-In\n"
            "2. Biometric passkey integration on Windows Hello\n"
            "3. Multi-tenant RBAC with Firestore\n"
        )
    },
    {
        "path": "C:/Users/Daniel/Documents/Work/project_spec_offline_sync.docx",
        "name": "project_spec_offline_sync.docx",
        "extension": "docx",
        "size": 420000,
        "modified": "2026-07-24T10:30:00Z",
        "content": (
            "PROJECT SPECIFICATION: Offline Sync & SQLite Indexing (v1.2)\n"
            "Author: Daniel\n"
            "Date: 2026-07-24\n"
            "Status: In Review\n"
            "Key Requirements:\n"
            "1. Native SQLite WAL mode\n"
            "2. Periodic background delta synchronization\n"
        )
    }
]


def stub_search_files(query: str, file_types: Optional[List[str]] = None, date_range: Optional[str] = None, max_results: int = 20) -> List[Dict[str, Any]]:
    """Simulates local filesystem search."""
    keywords = [k.lower() for k in query.split() if len(k) > 2]
    results = []

    for item in MOCK_FILES_DB:
        # Check file types
        if file_types and item["extension"].lower() not in [ft.lower().lstrip(".") for ft in file_types]:
            continue

        text_corpus = (item["name"] + " " + item["content"]).lower()
        # Check matching
        is_match = False
        if any(k in text_corpus for k in keywords):
            is_match = True
        elif ("receipt" in query.lower() or "expense" in query.lower()) and ("receipt" in text_corpus or "pdf" in item["extension"]):
            is_match = True
        elif "spec" in query.lower() and ("spec" in text_corpus or "project" in text_corpus):
            is_match = True
        elif "contractor" in query.lower() and ("contractor" in text_corpus or "invoice" in text_corpus):
            is_match = True

        if is_match:
            results.append({
                "path": item["path"],
                "name": item["name"],
                "extension": item["extension"],
                "size_bytes": item["size"],
                "modified": item["modified"],
                "snippet": item["content"][:200].replace("\n", " ")
            })

    return results[:max_results]


def stub_read_file_content(path: str, max_chars: int = 8000) -> Dict[str, Any]:
    """Simulates reading local file content."""
    normalized = path.replace("\\", "/").lower()
    for item in MOCK_FILES_DB:
        if item["path"].lower() == normalized or item["name"].lower() in normalized:
            return {
                "path": item["path"],
                "content": item["content"][:max_chars],
                "char_count": len(item["content"]),
                "status": "success"
            }
    return {
        "path": path,
        "content": "",
        "char_count": 0,
        "status": "not_found",
        "error": f"File not found at path: {path}"
    }


def stub_extract_fields(content: str, fields: List[str], instructions: Optional[str] = None) -> Dict[str, Any]:
    """Simulates structured field extraction from receipt text."""
    extracted = {}
    content_upper = content.upper()

    # Heuristic mock extraction
    if "FITNESS FIRST" in content_upper:
        extracted = {"merchant": "Fitness First", "date": "2026-07-02", "amount": 81.00, "category": "Gym / Fitness"}
    elif "DELTA AIR" in content_upper:
        extracted = {"merchant": "Delta Air Lines", "date": "2026-07-14", "amount": 423.50, "category": "Travel / Flight"}
    elif "HILTON" in content_upper:
        extracted = {"merchant": "Hilton Garden Inn NYC", "date": "2026-07-18", "amount": 343.00, "category": "Travel / Lodging"}
    elif "UBER" in content_upper:
        extracted = {"merchant": "Uber", "date": "2026-07-16", "amount": 68.20, "category": "Travel / Ground"}
    else:
        for f in fields:
            extracted[f] = "Unknown"

    return {
        "extracted_data": extracted,
        "fields_requested": fields,
        "status": "success"
    }


def stub_ask_user(question: str, options: Optional[List[str]] = None, preview_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Simulates requesting user approval."""
    return {
        "question": question,
        "options": options or ["Approve", "Edit", "Cancel"],
        "preview_data": preview_data,
        "status": "waiting_approval"
    }


def stub_create_artifact(filename: str, content_type: str, data: str) -> Dict[str, Any]:
    """Simulates writing an artifact to disk."""
    return {
        "filename": filename,
        "content_type": content_type,
        "byte_count": len(data.encode("utf-8")),
        "saved_path": f"C:/Users/Daniel/Documents/{filename}",
        "status": "created"
    }
