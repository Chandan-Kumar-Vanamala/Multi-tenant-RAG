import json
import time
import sys
import os
import httpx

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from groq import Groq
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL = "http://127.0.0.1:8000"
LOGIN_EMAIL = "admin@acme.com"
LOGIN_PASSWORD = "password123"
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

JUDGE_MODEL = "llama-3.3-70b-versatile"
JUDGE_PROMPT = """You are an evaluation judge. Your job is to score a RAG system's answer against an expected answer.

Question: {question}
Expected Answer: {expected}
Actual Answer: {actual}

Score the actual answer on a scale of 0-10:
- 10: Perfect match, all key information present and accurate
- 7-9: Good answer, main points covered, minor details missing
- 4-6: Partial answer, some correct information but missing key points
- 1-3: Poor answer, mostly incorrect or irrelevant
- 0: Completely wrong or refused to answer

Respond with ONLY a JSON object in this exact format:
{{"score": <number 0-10>, "reasoning": "<one sentence explanation>"}}"""


# ── Auth ──────────────────────────────────────────────────────────────────────

def get_token() -> str:
    response = httpx.post(
        f"{BASE_URL}/auth/login",
        data={"username": LOGIN_EMAIL, "password": LOGIN_PASSWORD}
    )
    response.raise_for_status()
    return response.json()["access_token"]


# ── Query ─────────────────────────────────────────────────────────────────────

def ask_question(question: str, token: str) -> tuple[str, float]:
    start = time.time()
    response = httpx.post(
        f"{BASE_URL}/query/",
        json={"question": question, "stream": False},
        headers={"Authorization": f"Bearer {token}"},
        timeout=60.0
    )
    latency = time.time() - start

    if response.status_code != 200:
        return f"ERROR: {response.status_code} {response.text}", latency

    data = response.json()
    return data.get("answer", "No answer returned"), latency


# ── Judge ─────────────────────────────────────────────────────────────────────

def judge_answer(question: str, expected: str, actual: str, client: Groq) -> dict:
    prompt = JUDGE_PROMPT.format(
        question=question,
        expected=expected,
        actual=actual
    )

    response = client.chat.completions.create(
        model=JUDGE_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,  # deterministic judging
        max_tokens=200
    )

    raw = response.choices[0].message.content.strip()

    try:
        # Strip markdown code fences if present
        clean = raw.replace("```json", "").replace("```", "").strip()
        return json.loads(clean)
    except json.JSONDecodeError:
        return {"score": 0, "reasoning": f"Judge parse error: {raw}"}


# ── Main eval loop ────────────────────────────────────────────────────────────

def run_eval(prompt_version: str = "v1"):
    print(f"\n{'='*60}")
    print(f"Running evaluation — Prompt version: {prompt_version}")
    print(f"{'='*60}\n")

    # Load test questions
    with open("eval/questions.json") as f:
        questions = json.load(f)

    groq_client = Groq(api_key=GROQ_API_KEY)

    # Get auth token
    print("Authenticating...")
    token = get_token()
    print("Authenticated.\n")

    results = []
    total_score = 0
    total_latency = 0

    for i, item in enumerate(questions):
        print(f"[{i+1}/{len(questions)}] {item['question'][:60]}...")

        # Ask the question
        actual_answer, latency = ask_question(item["question"], token)

        # Judge the answer
        judgment = judge_answer(
            question=item["question"],
            expected=item["expected"],
            actual=actual_answer,
            client=groq_client
        )

        score = judgment.get("score", 0)
        reasoning = judgment.get("reasoning", "")
        total_score += score
        total_latency += latency

        result = {
            "id": item["id"],
            "question": item["question"],
            "expected": item["expected"],
            "actual": actual_answer,
            "score": score,
            "reasoning": reasoning,
            "latency_seconds": round(latency, 2)
        }
        results.append(result)

        print(f"  Score: {score}/10 | Latency: {latency:.2f}s | {reasoning[:80]}")

        # Small delay to avoid rate limiting
        time.sleep(0.5)

    # ── Summary ───────────────────────────────────────────────────────────────
    avg_score = total_score / len(questions)
    avg_latency = total_latency / len(questions)
    accuracy_pct = (avg_score / 10) * 100

    summary = {
        "prompt_version": prompt_version,
        "total_questions": len(questions),
        "average_score": round(avg_score, 2),
        "accuracy_percent": round(accuracy_pct, 1),
        "average_latency_seconds": round(avg_latency, 2),
        "results": results
    }

    # Save report
    report_path = f"eval/report_{prompt_version}.json"
    with open(report_path, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\n{'='*60}")
    print(f"RESULTS — Prompt {prompt_version}")
    print(f"{'='*60}")
    print(f"Average Score:    {avg_score:.1f}/10")
    print(f"Accuracy:         {accuracy_pct:.1f}%")
    print(f"Average Latency:  {avg_latency:.2f}s")
    print(f"Report saved to:  {report_path}")
    print(f"{'='*60}\n")

    return summary


if __name__ == "__main__":
    version = sys.argv[1] if len(sys.argv) > 1 else "v1"
    run_eval(version)