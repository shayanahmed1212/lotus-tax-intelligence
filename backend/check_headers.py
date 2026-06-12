import csv
import os

def check_headers(data_dir="data"):
    print(f"Checking CSV headers in: '{data_dir}'\n" + "-"*50)
    
    if not os.path.exists(data_dir):
        print(f"Error: Could not find directory '{data_dir}'.")
        print("Make sure you are running this from D:\\triad\\backend")
        return

    for filename in os.listdir(data_dir):
        if filename.endswith(".csv"):
            filepath = os.path.join(data_dir, filename)
            try:
                with open(filepath, 'r', encoding='utf-8-sig') as f:
                    reader = csv.reader(f)
                    headers = next(reader, None)
                    print(f"📄 File: {filename}")
                    # Print headers as a nicely formatted list
                    if headers:
                        print(f"   Headers: {', '.join(headers)}\n")
                    else:
                        print("   Headers: [File is empty]\n")
            except Exception as e:
                print(f"❌ Could not read {filename}: {e}\n")

if __name__ == "__main__":
    check_headers()