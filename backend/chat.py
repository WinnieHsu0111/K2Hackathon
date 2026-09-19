from openai import OpenAI
from dotenv import load_dotenv
import os

load_dotenv()

client = OpenAI(api_key=os.getenv("K2_API_KEY"), base_url=os.getenv("K2_BASE_URL"))
model = os.getenv("K2_MODEL")
messages = []

print("Chat with K2 (type 'quit' to exit)\n")
while True:
    user_input = input("You: ")
    if user_input.lower() == "quit":
        break
    messages.append({"role": "user", "content": user_input})
    r = client.chat.completions.create(model=model, messages=messages)
    msg = r.choices[0].message
    reply = msg.content
    assistant_msg = {"role": "assistant", "content": reply}
    if hasattr(msg, "reasoning") and msg.reasoning:
        assistant_msg["reasoning"] = msg.reasoning
    messages.append(assistant_msg)
    print(f"K2: {reply}\n")
