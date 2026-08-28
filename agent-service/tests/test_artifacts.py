"""Tests for ArtifactBuilder (CSV, Markdown, JSON)."""
import pytest
import csv
import io
import json
from agent.artifacts import ArtifactBuilder


SAMPLE_ROWS = [
    {
        "merchant": "Fitness First",
        "date": "2026-07-02",
        "category": "Gym / Fitness",
        "amount": 81.00,
        "currency": "USD",
        "invoice_number": "FF-99214",
        "file": "fit_gym_july.pdf"
    },
    {
        "merchant": "Delta Air Lines",
        "date": "2026-07-14",
        "category": "Travel / Flight",
        "amount": 423.50,
        "currency": "USD",
        "invoice_number": "H7X9KP",
        "file": "delta_flight.pdf"
    },
    {
        "merchant": "Hilton Garden Inn NYC",
        "date": "2026-07-18",
        "category": "Travel / Lodging",
        "amount": 343.00,
        "currency": "USD",
        "invoice_number": "440981",
        "file": "hilton_hotel.pdf"
    }
]


def test_build_expense_csv():
    csv_str = ArtifactBuilder.build_expense_csv(SAMPLE_ROWS)
    reader = list(csv.reader(io.StringIO(csv_str)))

    # Header
    assert reader[0] == ["Merchant", "Date", "Category", "Amount ($)", "Currency", "Invoice #", "Source File"]
    # Data rows
    assert reader[1][0] == "Fitness First"
    assert reader[1][3] == "81.00"
    assert reader[2][0] == "Delta Air Lines"
    assert reader[2][3] == "423.50"
    # Total row
    total_row = reader[-1]
    assert total_row[0] == "TOTAL"
    assert total_row[3] == "847.50"


def test_build_expense_markdown():
    md_str = ArtifactBuilder.build_expense_markdown(SAMPLE_ROWS)
    assert "# Expense Report Summary" in md_str
    assert "**Total Expenses**: $847.50" in md_str
    assert "- **Travel / Flight**: $423.50" in md_str
    assert "| Fitness First | 2026-07-02 | Gym / Fitness | $81.00 |" in md_str


def test_build_expense_json():
    json_str = ArtifactBuilder.build_expense_json(SAMPLE_ROWS)
    data = json.loads(json_str)
    assert data["metadata"]["total_expense"] == 847.50
    assert len(data["items"]) == 3
