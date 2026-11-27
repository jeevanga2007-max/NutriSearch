import os
import pandas as pd
from pymongo import MongoClient, ASCENDING, TEXT
from pymongo.errors import BulkWriteError
from dotenv import load_dotenv

load_dotenv()
client = MongoClient(os.environ["MONGODB_URI"])
col = client["nutriscan"]["products"]

FILE = "data/en.openfoodfacts.org.products.csv.gz"

col.drop()   # one-time: wipe old data so the new fields are included
TEXT_COLS = ["code", "product_name", "brands", "quantity", "ingredients_text",
             "allergens", "allergens_tags", "traces", "traces_tags",
             "ingredients_analysis_tags", "labels_tags", "categories_en",
             "categories_tags", "additives_tags", "nutriscore_grade",
             "countries_tags", "countries_en", "image_url", "image_small_url"]
NUM_COLS = ["nova_group", "energy-kcal_100g", "sugars_100g", "fat_100g",
            "saturated-fat_100g", "salt_100g", "proteins_100g",
            "sodium_100g", "carbohydrates_100g", "fiber_100g"]

# Create the unique index FIRST so duplicate barcodes are rejected
col.create_index([("code", ASCENDING)], unique=True)

total = 0
for chunk in pd.read_csv(FILE, sep="\t", usecols=TEXT_COLS + NUM_COLS,
                         dtype=str, chunksize=100_000, on_bad_lines="skip"):
    # keep only products sold in India
    chunk = chunk[chunk["countries_tags"].fillna("").str.contains("en:india")]
    # must have a barcode and a name
    chunk = chunk.dropna(subset=["code", "product_name"])
    # convert numeric columns
    for c in NUM_COLS:
        chunk[c] = pd.to_numeric(chunk[c], errors="coerce")

    docs = []
    for rec in chunk.to_dict("records"):
        doc = {k: v for k, v in rec.items() if pd.notna(v)}  # drop empty fields
        for field in ("allergens_tags", "traces_tags", "ingredients_analysis_tags",
                      "labels_tags", "categories_tags", "additives_tags"):
            if field in doc:
                doc[field] = doc[field].split(",")
        docs.append(doc)

    if docs:
        try:
            col.insert_many(docs, ordered=False)
        except BulkWriteError:
            pass  # skips duplicates, continues with the rest
        total += len(docs)
        print(f"Processed {total} products so far...")

print("Done.")