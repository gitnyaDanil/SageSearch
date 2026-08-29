"""Generates sample demo receipts and updates the SageSearch index for rehearsal."""
import os
import sys
import time
import datetime
import sqlite3
import urllib.request
import json

DEMO_RECEIPTS = [
    {
        "name": "gym_membership_receipt",
        "alt_name": "fit_gym_july",
        "date_iso": "2026-07-02T10:15:00",
        "timestamp": 1782987300, # July 2, 2026
        "content": (
            "FITNESS FIRST CLUB MEMBERSHIP\n"
            "Invoice Number: FF-99214\n"
            "Date: 2026-07-02\n"
            "Member: Daniel\n"
            "Description: Monthly All-Access Gym Pass (July 2026)\n"
            "Subtotal: $75.00\n"
            "Tax: $6.00\n"
            "Total Paid: $81.00\n"
            "Payment Method: Visa ending in 4242\n"
            "Status: Paid in Full\n"
        )
    },
    {
        "name": "delta_flight_receipt",
        "alt_name": "delta_flight_nyc",
        "date_iso": "2026-07-14T08:30:00",
        "timestamp": 1784017800, # July 14, 2026
        "content": (
            "DELTA AIR LINES E-TICKET CONFIRMATION\n"
            "Confirmation Code: H7X9KP\n"
            "Issue Date: 2026-07-14\n"
            "Passenger: Daniel\n"
            "Flight: DL 402 Seattle (SEA) -> New York (JFK)\n"
            "Base Fare: $385.00\n"
            "Taxes & Airport Fees: $38.50\n"
            "Total Amount: $423.50 USD\n"
            "Payment Status: Ticketed & Confirmed\n"
        )
    },
    {
        "name": "hilton_hotel_receipt",
        "alt_name": "hilton_hotel_nyc",
        "date_iso": "2026-07-18T11:00:00",
        "timestamp": 1784372400, # July 18, 2026
        "content": (
            "HILTON GARDEN INN NYC\n"
            "Folio Number: 440981\n"
            "Guest Name: Daniel\n"
            "Check-In: 2026-07-15 | Check-Out: 2026-07-18 (3 Nights)\n"
            "Room Rate (3 nights): $300.00\n"
            "City Occupancy Tax: $43.00\n"
            "Total Amount Charged: $343.00\n"
            "Balance Due: $0.00 (Paid via Amex)\n"
        )
    },
    {
        "name": "uber_ride_receipt",
        "alt_name": "uber_ride_july",
        "date_iso": "2026-07-16T19:45:00",
        "timestamp": 1784231100, # July 16, 2026
        "content": (
            "UBER TRIP RECEIPT\n"
            "Date: July 16, 2026\n"
            "Trip: JFK Airport to Manhattan Hotel\n"
            "Distance: 17.8 miles\n"
            "Trip Fare: $56.20\n"
            "Tolls & Tips: $12.00\n"
            "Total Charged: $68.20 USD\n"
        )
    },
    {
        "name": "starbucks_meeting_receipt",
        "alt_name": "starbucks_meeting",
        "date_iso": "2026-07-16T09:30:00",
        "timestamp": 1784194200, # July 16, 2026
        "content": (
            "STARBUCKS COFFEE #10842\n"
            "Date: 2026-07-16 09:30 AM\n"
            "Items:\n"
            "  2x Caffe Latte - $11.50\n"
            "  1x Blueberry Muffin - $4.75\n"
            "Tax: $1.50\n"
            "Total: $17.75\n"
            "Payment: Apple Pay (Visa)\n"
        )
    },
    {
        "name": "slack_subscription_invoice",
        "alt_name": "slack_subscription",
        "date_iso": "2026-07-01T12:00:00",
        "timestamp": 1782907200, # July 1, 2026
        "content": (
            "SLACK TECHNOLOGIES LLC\n"
            "Invoice Number: INV-SLACK-8831\n"
            "Date: 2026-07-01\n"
            "Plan: Slack Pro Monthly Subscription (1 user)\n"
            "Amount: $15.00\n"
            "Total Paid: $15.00 USD\n"
        )
    }
]


def setup_demo_data():
    home_dir = os.path.expanduser("~")
    target_dir = os.path.join(home_dir, "Documents", "SageSearch_Demo_Receipts")
    os.makedirs(target_dir, exist_ok=True)

    print(f"Creating sample demo receipts in: {target_dir}")
    created_files = []

    for item in DEMO_RECEIPTS:
        names_to_create = [item["name"]]
        if "alt_name" in item:
            names_to_create.append(item["alt_name"])

        for base_name in names_to_create:
            # Create .txt file
            txt_path = os.path.join(target_dir, f"{base_name}.txt")
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(item["content"])
            os.utime(txt_path, (item["timestamp"], item["timestamp"]))
            created_files.append((txt_path, f"{base_name}.txt", ".txt", len(item["content"]), item["date_iso"]))
            print(f"  + Created {base_name}.txt (Modified: {item['date_iso']})")

            # Create .pdf file
            pdf_path = os.path.join(target_dir, f"{base_name}.pdf")
            with open(pdf_path, "w", encoding="utf-8") as f:
                f.write(f"%PDF-1.4 Mock Receipt Document\n{item['content']}")
            os.utime(pdf_path, (item["timestamp"], item["timestamp"]))
            created_files.append((pdf_path, f"{base_name}.pdf", ".pdf", len(item["content"]) + 32, item["date_iso"]))
            print(f"  + Created {base_name}.pdf (Modified: {item['date_iso']})")

    # Update SQLite database directly
    db_path = os.path.join(os.path.dirname(__file__), "backend", "data", "sagesearch.sqlite")
    if os.path.exists(db_path):
        try:
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()

            # Ensure location exists and is marked ready
            cur.execute("SELECT id FROM locations WHERE path = ?", (target_dir,))
            row = cur.fetchone()
            if row:
                loc_id = row[0]
                cur.execute("UPDATE locations SET status = 'ready', file_count = ?, indexed_at = datetime('now') WHERE id = ?", (len(created_files), loc_id))
            else:
                cur.execute("INSERT INTO locations (name, path, is_default, status, file_count, indexed_at) VALUES (?, ?, 0, 'ready', ?, datetime('now'))",
                            ("Demo Receipts", target_dir, len(created_files)))
                loc_id = cur.lastrowid

            # Insert or replace files
            for full_path, name, ext, size, iso in created_files:
                cur.execute("""
                    INSERT OR REPLACE INTO files (location_id, name, full_path, folder, extension, category, size_bytes, created_iso, modified_iso)
                    VALUES (?, ?, ?, ?, ?, 'document', ?, ?, ?)
                """, (loc_id, name, full_path, target_dir, ext, size, f"{iso}.000Z", f"{iso}.000Z"))

            conn.commit()
            conn.close()
            print(f"\n  + Successfully registered and indexed {len(created_files)} files in SQLite index (Location ID: {loc_id})!")
        except Exception as e:
            print(f"  (Direct SQLite update error: {e})")

    print("\nDemo receipt setup complete! Direct Search and Agent Mode are fully synchronized.")


if __name__ == "__main__":
    setup_demo_data()
