import json
import time
import sys
import os
import httpx

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from groq import Groq
from groq import RateLimitError as GroqRateLimitError
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL        = "http://127.0.0.1:8000"
LOGIN_EMAIL     = "admin@acme.com"
LOGIN_PASSWORD  = "password123"
GROQ_API_KEY    = os.getenv("GROQ_API_KEY")
LLM_MODEL       = "llama-3.3-70b-versatile"

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


# ── Load prompt versions ───────────────────────────────────────────────────────

def load_prompt(version: str) -> dict:
    """Return the prompt entry for the given version from prompts.json."""
    prompts_path = os.path.join(os.path.dirname(__file__), "prompts.json")
    with open(prompts_path) as f:
        prompts = json.load(f)
    for p in prompts:
        if p["version"] == version:
            return p
    raise ValueError(f"Prompt version '{version}' not found in prompts.json. "
                     f"Available: {[p['version'] for p in prompts]}")


# ── Auth ───────────────────────────────────────────────────────────────────────

def get_token() -> str:
    response = httpx.post(
        f"{BASE_URL}/auth/login",
        data={"username": LOGIN_EMAIL, "password": LOGIN_PASSWORD}
    )
    response.raise_for_status()
    return response.json()["access_token"]


# ── Conversation ───────────────────────────────────────────────────────────────

def create_conversation(token: str) -> str:
    """Create a fresh conversation for this eval run and return its id."""
    response = httpx.post(
        f"{BASE_URL}/conversations/",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15.0
    )
    response.raise_for_status()
    return response.json()["id"]


# ── Retrieve context from the RAG API ─────────────────────────────────────────

def retrieve_context(
    question: str,
    token: str,
    conversation_id: str
) -> tuple[str, list, float, str]:
    """
    Call the non-streaming /query/ endpoint.
    Returns (answer, citations, latency, conversation_id_used).
    Retries up to 3 times on 500 (server cold-start / embedding model loading).
    Auto-rotates conversation on 4xx errors.
    """
    MAX_SERVER_RETRIES = 3

    for attempt in range(MAX_SERVER_RETRIES):
        start = time.time()
        try:
            response = httpx.post(
                f"{BASE_URL}/query/",
                json={"question": question, "stream": False, "conversation_id": conversation_id},
                headers={"Authorization": f"Bearer {token}"},
                timeout=60.0
            )
        except httpx.RequestError as e:
            if attempt < MAX_SERVER_RETRIES - 1:
                print(f"  [warn] connection error ({e}), retrying in 5s...")
                time.sleep(5)
                continue
            return f"ERROR: connection failed — {e}", [], time.time() - start, conversation_id

        latency = time.time() - start

        if response.status_code == 200:
            data = response.json()
            return data.get("answer", ""), data.get("citations", []), latency, conversation_id

        if response.status_code == 500 and attempt < MAX_SERVER_RETRIES - 1:
            print(f"  [warn] server 500 (attempt {attempt+1}), retrying in 8s (model may be loading)...")
            time.sleep(8)
            continue

        if response.status_code in (404, 422) and attempt == 0:
            # Conversation stale — rotate and retry
            print(f"  [warn] query returned {response.status_code}, rotating conversation...")
            conversation_id = create_conversation(token)
            continue

        return f"ERROR: {response.status_code} {response.text}", [], latency, conversation_id

    return "ERROR: max server retries exceeded", [], 0.0, conversation_id


# ── Generate answer with a specific prompt version ────────────────────────────

def generate_answer(
    question: str,
    system_prompt: str,
    token: str,
    conversation_id: str,
    groq_client: Groq
) -> tuple[str, float, str]:
    """
    Retrieve context from the RAG backend, then re-generate using the given
    system_prompt. Returns (answer, total_latency, conversation_id_used).
    """
    server_answer, citations, api_latency, conversation_id = retrieve_context(
        question, token, conversation_id
    )

    if server_answer.startswith("ERROR:"):
        return server_answer, api_latency, conversation_id

    groq_start = time.time()
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Context:\n{server_answer}\n\nQuestion: {question}"}
    ]
    resp = groq_client.chat.completions.create(
        model=LLM_MODEL,
        messages=messages,
        temperature=0.1,
        max_tokens=512
    )
    groq_latency = time.time() - groq_start
    answer = resp.choices[0].message.content.strip()

    return answer, api_latency + groq_latency, conversation_id


# ── Judge ─────────────────────────────────────────────────────────────────────

def judge_answer(question: str, expected: str, actual: str, client: Groq) -> dict:
    prompt = JUDGE_PROMPT.format(
        question=question,
        expected=expected,
        actual=actual
    )

    # Retry on Groq rate-limit with exponential backoff
    for backoff in [0, 30, 60, 120]:
        if backoff:
            print(f"  [rate-limit] waiting {backoff}s before retry...")
            time.sleep(backoff)
        try:
            response = client.chat.completions.create(
                model=LLM_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,   # deterministic judging
                max_tokens=200
            )
            raw = response.choices[0].message.content.strip()
            try:
                clean = raw.replace("```json", "").replace("```", "").strip()
                return json.loads(clean)
            except json.JSONDecodeError:
                return {"score": 0, "reasoning": f"Judge parse error: {raw}"}
        except GroqRateLimitError as e:
            print(f"  [rate-limit] Groq 429: {e}")

    return {"score": -1, "reasoning": "Rate limit exhausted — result skipped"}


# ── Main eval loop ────────────────────────────────────────────────────────────

def run_eval(prompt_version: str = "v1"):
    print(f"\n{'='*60}")
    print(f"Running evaluation — Prompt version: {prompt_version}")
    print(f"{'='*60}\n")

    # Load the prompt definition for this version
    prompt_def = load_prompt(prompt_version)
    system_prompt = prompt_def["system_prompt"]
    print(f"Prompt: {prompt_def['description']}\n")

    # Load test questions
    questions_path = os.path.join(os.path.dirname(__file__), "questions.json")
    with open(questions_path) as f:
        questions = json.load(f)

    groq_client = Groq(api_key=GROQ_API_KEY)

    # Get auth token and create a fresh conversation
    print("Authenticating...")
    token = get_token()
    print("Authenticated.")
    conversation_id = create_conversation(token)
    print(f"Eval conversation created: {conversation_id}\n")

    results = []
    total_score = 0
    total_latency = 0

    for i, item in enumerate(questions):
        print(f"[{i+1}/{len(questions)}] {item['question'][:60]}...")

        # Generate answer using the versioned system prompt
        actual_answer, latency, conversation_id = generate_answer(
            question=item["question"],
            system_prompt=system_prompt,
            token=token,
            conversation_id=conversation_id,
            groq_client=groq_client
        )

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
        "prompt_description": prompt_def["description"],
        "total_questions": len(questions),
        "average_score": round(avg_score, 2),
        "accuracy_percent": round(accuracy_pct, 1),
        "average_latency_seconds": round(avg_latency, 2),
        "results": results
    }

    # Save report
    report_path = os.path.join(os.path.dirname(__file__), f"report_{prompt_version}.json")
    with open(report_path, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\n{'='*60}")
    print(f"RESULTS — Prompt {prompt_version}: {prompt_def['description']}")
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