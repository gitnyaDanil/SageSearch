"""Tests for StructuredFieldExtractor."""
import pytest
from agent.extractor import StructuredFieldExtractor, ExtractedReceipt


def test_extracted_receipt_schema():
    data = {
        "merchant": "Delta Air Lines",
        "date": "2026-07-14",
        "amount": 423.50,
        "currency": "USD",
        "category": "Travel / Flight",
        "invoice_number": "H7X9KP",
        "notes": "Seattle to JFK"
    }
    receipt = ExtractedReceipt(**data)
    assert receipt.merchant == "Delta Air Lines"
    assert receipt.amount == 423.50
    assert receipt.category == "Travel / Flight"


def test_heuristic_extraction_gym_invoice():
    extractor = StructuredFieldExtractor()
    gym_text = """
    FITNESS FIRST CLUB MEMBERSHIP
    Invoice #: FF-99214
    Date: 2026-07-02
    Member: Daniel
    Description: Monthly All-Access Gym Pass
    Total Paid: $81.00
    """
    res = extractor.extract_from_text(gym_text)
    assert res["status"] == "success"
    data = res["extracted_data"]
    assert data["merchant"] == "Fitness First"
    assert data["amount"] == 81.00
    assert data["date"] == "2026-07-02"
    assert data["category"] == "Gym / Fitness"


def test_heuristic_extraction_hotel_folio():
    extractor = StructuredFieldExtractor()
    hotel_text = """
    HILTON GARDEN INN NYC
    Folio Number: 440981
    Check-In: 2026-07-15 | Check-Out: 2026-07-18
    Guest: Daniel
    Total Amount Charged: $343.00
    """
    res = extractor.extract_from_text(hotel_text)
    assert res["status"] == "success"
    data = res["extracted_data"]
    assert data["merchant"] == "Hilton Garden Inn NYC"
    assert data["amount"] == 343.00
    assert data["category"] == "Travel / Lodging"


def test_heuristic_extraction_empty_text():
    extractor = StructuredFieldExtractor()
    res = extractor.extract_from_text("")
    assert res["status"] == "empty_content"
