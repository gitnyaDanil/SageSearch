"""Generates sample demo receipts for SageSearch-Agent competition rehearsal."""
import os
import sys
import json
import urllib.request

DEMO_RECEIPTS = [
    {
        "filename": "fit_gym_july.txt",
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
        "filename": "delta_flight_nyc.txt",
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
        "filename": "hilton_hotel_nyc.txt",
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
        "filename": "uber_ride_july.txt",
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
        "filename": "starbucks_meeting.txt",
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
        "filename": "slack_subscription.txt",
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
    for item in DEMO_RECEIPTS:
        file_path = os.path.join(target_dir, item["filename"])
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(item["content"])
        print(f"  + Created {item['filename']}")

    print("\nAttempting to register and index folder with SageSearch backend (if running)...")
    try:
        req = urllib.request.Request(
            "http://localhost:3001/api/locations",
            data=json.dumps({"name": "Demo Receipts", "path": target_dir}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            print("  + Successfully added 'Demo Receipts' to search index locations!")
    except Exception:
        print("  (Note: Backend is not currently running. The folder is ready in Documents and will index upon launch.)")

    print("\nDemo receipt setup complete! Ready for Taskmaster workflow.")


if __name__ == "__main__":
    setup_demo_data()
