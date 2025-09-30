from flask import Flask, render_template, request, abort, redirect, url_for, session, jsonify, send_from_directory
import os, json, time, re, smtplib, ssl, random, string
from email.mime.text import MIMEText
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# -------------------- App & Config --------------------
load_dotenv()
app = Flask(__name__)

# Secret key for sessions (dev-safe). In production, set via env var.
app.secret_key = os.getenv("FLASK_SECRET_KEY") or os.urandom(24)

# Allowed hosts (set ALLOWED_HOSTS on Render to include your domain)
# If ALLOWED_HOSTS is empty, we won't block.
ALLOWED = set(h.strip().lower() for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h.strip())

@app.before_request
def _enforce_allowed_hosts():
    if not ALLOWED:
        return  # no restriction if env var not set
    host = (request.headers.get("Host") or "").split(":")[0].lower()
    if host and host not in ALLOWED:
        return "Bad Request (host not allowed)", 400

# Persistent dir (Render disk) or local folder
PERSIST_DIR = os.environ.get("PERSIST_DIR", "")
if PERSIST_DIR and not os.path.exists(PERSIST_DIR):
    os.makedirs(PERSIST_DIR, exist_ok=True)

USERS_FILE = os.path.join(PERSIST_DIR or ".", "users.json")

UPLOAD_DIR = os.path.join("static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
ALLOWED_EXT = {"png", "jpg", "jpeg", "webp", "gif"}

# -------------------- Admin Defaults --------------------
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "AdminPass123!"
ADMIN_EMAIL    = "local-admin@localhost"

# -------------------- Utilities --------------------
def load_users():
    if not os.path.exists(USERS_FILE):
        with open(USERS_FILE, "w", encoding="utf-8") as f:
            json.dump({}, f)
        return {}
    with open(USERS_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f) or {}
        except Exception:
            return {}

def save_users(users):
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2)

def norm_phone(s):
    return re.sub(r"\D+", "", s or "")

def mask_email(e):
    e = (e or "").strip()
    if "@" not in e:
        return e
    name, dom = e.split("@", 1)
    if len(name) <= 2:
        name_mask = name[0] + "*"
    else:
        name_mask = name[0] + "*"*(len(name)-2) + name[-1]
    return f"{name_mask}@{dom}"

def find_user(users, identifier):
    """Find by username (case-insensitive), email (case-insensitive), or phone (digits only)."""
    ident = (identifier or "").strip()
    if not ident:
        return None, None
    ident_lower = ident.lower()
    ident_phone = norm_phone(ident)
    for uname, u in users.items():
        if uname.lower() == ident_lower:
            return uname, u
        if (u.get("email") or "").lower() == ident_lower:
            return uname, u
        if ident_phone and norm_phone(u.get("phone")) == ident_phone:
            return uname, u
    return None, None

# Initialize admin user if missing
_users = load_users()
if ADMIN_USERNAME not in _users:
    _users[ADMIN_USERNAME] = {
        "email": ADMIN_EMAIL,
        "phone": "",
        "password": ADMIN_PASSWORD,
        "history": [],
        "flashcards": [],
        "planner": [],
        "settings": {},
        "display_name": "Admin",
        "avatar_path": "static/images/default_avatar.png",
        "admin": True,
        "first_login": True
    }
    save_users(_users)

# -------------------- Email sending (real if SMTP envs set; else dev echo) --------------------
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USER or "no-reply@local")
DEV_EMAIL_ECHO = os.getenv("DEV_EMAIL_ECHO", "1") == "1"  # echo OTP in JSON for easy testing

def _send_email(to_email: str, subject: str, body: str) -> bool:
    """Returns True if sent (SMTP configured), False if only echoed in logs/dev."""
    if SMTP_HOST and SMTP_USER and SMTP_PASS:
        try:
            msg = MIMEText(body)
            msg["Subject"] = subject
            msg["From"] = FROM_EMAIL
            msg["To"] = to_email
            context = ssl.create_default_context()
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
                server.starttls(context=context)
                server.login(SMTP_USER, SMTP_PASS)
                server.send_message(msg)
            return True
        except Exception as e:
            print(f"[EMAIL ERROR] {e}")
            return False
    # Dev: no SMTP configured; just log it
    print(f"[DEV EMAIL] To: {to_email} | {subject} | {body}")
    return False

def _new_otp():
    return "".join(random.choice(string.digits) for _ in range(6))

# -------------------- Safe Test Mode “AI” --------------------
def get_ai_answer(question, mode="explain"):
    q = (question or "").strip()
    if not q:
        return "Please type a question."
    if mode == "example":
        return f"[TEST MODE] Example-based explanation for: {q}"
    if mode == "explain":
        return f"[TEST MODE] Step-by-step explanation for: {q}"
    return f"[TEST MODE] Answer for ({mode}): {q}"

# -------------------- Auth Views --------------------
@app.route("/")
def root():
    if "username" not in session:
        return redirect(url_for("login"))
    return redirect(url_for("index"))

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        identifier = (request.form.get("identifier") or "").strip()
        password   = (request.form.get("password") or "").strip()
        users = load_users()
        uname, user = find_user(users, identifier)

        if user and (user.get("password") or "").strip() == password:
            session["username"] = uname
            if user.get("first_login"):
                return redirect(url_for("onboarding"))
            return redirect(url_for("index"))

        if not uname:
            return render_template("login.html", error="No account found for that username/email/phone.")
        return render_template("login.html", error="Password incorrect.")
    return render_template("login.html")

# ---- Phone + password login (existing) ----
@app.route("/login/phone", methods=["POST"])
def login_phone():
    phone = norm_phone(request.form.get("phone"))
    password = (request.form.get("password") or "").strip()
    users = load_users()
    uname, user = find_user(users, phone) if phone else (None, None)

    if user and (user.get("password") or "").strip() == password:
        session["username"] = uname
        if user.get("first_login"):
            return redirect(url_for("onboarding"))
        return redirect(url_for("index"))

    return render_template("login.html", error="Phone or password incorrect.")

# ---- Email OTP login (new) ----
@app.route("/login/email/request", methods=["POST"])
def email_login_request():
    email = (request.form.get("email") or "").strip().lower()
    if not email:
        return jsonify({"error": "Email required"}), 400
    users = load_users()
    uname, user = find_user(users, email)
    if not uname:
        return jsonify({"error": "No account with that email"}), 404

    code = _new_otp()
    expire = int(time.time()) + 600  # 10 minutes
    users[uname]["_email_otp"] = code
    users[uname]["_email_otp_exp"] = expire
    save_users(users)

    body = f"Your Homework Helper login code is: {code}\nThis code expires in 10 minutes."
    was_sent = _send_email(email, "Your login code", body)
    masked = mask_email(email)

    # If SMTP not configured, DEV_EMAIL_ECHO lets you see the code in JSON for testing
    if not was_sent and DEV_EMAIL_ECHO:
        return jsonify({"ok": True, "email": masked, "dev_code": code})

    return jsonify({"ok": True, "email": masked})

@app.route("/login/email/verify", methods=["POST"])
def email_login_verify():
    email = (request.form.get("email") or "").strip().lower()
    code  = (request.form.get("code") or "").strip()
    if not email or not code:
        return jsonify({"error": "Email and code required"}), 400

    users = load_users()
    uname, user = find_user(users, email)
    if not uname:
        return jsonify({"error": "No account with that email"}), 404

    stored = (user.get("_email_otp") or "").strip()
    exp    = int(user.get("_email_otp_exp") or 0)
    now    = int(time.time())

    if not stored or now > exp:
        return jsonify({"error": "Code expired. Request a new one."}), 400
    if code != stored:
        return jsonify({"error": "Invalid code."}), 400

    # success
    users[uname].pop("_email_otp", None)
    users[uname].pop("_email_otp_exp", None)
    save_users(users)

    session["username"] = uname
    # first time, send to onboarding
    if users[uname].get("first_login"):
        return jsonify({"ok": True, "redirect": url_for("onboarding")})
    return jsonify({"ok": True, "redirect": url_for("index")})

@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        email    = (request.form.get("email") or "").strip()
        phone    = norm_phone(request.form.get("phone"))
        password = (request.form.get("password") or "").strip()
        consent  = request.form.get("consent")

        if not consent:
            return render_template("signup.html", error="You must agree to Terms & Privacy")
        # REQUIRE email now (phone optional)
        if not username or not password or not email:
            return render_template("signup.html", error="Username, password, and email are required")

        users = load_users()
        if username in users:
            return render_template("signup.html", error="Username already exists")
        _, byEmail = find_user(users, email)
        if byEmail:
            return render_template("signup.html", error="Email already in use")
        if phone:
            _, byPhone = find_user(users, phone)
            if byPhone:
                return render_template("signup.html", error="Phone already in use")

        users[username] = {
            "email": email,
            "phone": phone,
            "password": password,
            "history": [],
            "flashcards": [],
            "planner": [],
            "settings": {},
            "display_name": username,
            "avatar_path": "static/images/default_avatar.png",
            "admin": False,
            "first_login": True
        }
        save_users(users)
        session["username"] = username
        return redirect(url_for("onboarding"))

    return render_template("signup.html")

@app.route("/logout")
def logout():
    session.pop("username", None)
    return redirect(url_for("login"))

# -------------------- Onboarding & Main --------------------
@app.route("/onboarding", methods=["GET", "POST"])
def onboarding():
    if "username" not in session:
        return redirect(url_for("login"))
    users = load_users()
    uname = session["username"]
    user = users.get(uname, {})

    if request.method == "POST":
        display_name = (request.form.get("display_name") or uname).strip()
        avatar_path  = (request.form.get("avatar_path") or "static/images/default_avatar.png").strip()
        users[uname]["display_name"] = display_name
        users[uname]["avatar_path"]  = avatar_path
        users[uname]["first_login"]  = False
        save_users(users)
        return redirect(url_for("index"))

    return render_template(
        "onboarding.html",
        display_name=user.get("display_name") or uname,
        avatar_path=user.get("avatar_path") or "static/images/default_avatar.png"
    )

@app.route("/index")
def index():
    if "username" not in session:
        return redirect(url_for("login"))
    users = load_users()
    uname = session["username"]
    user = users.get(uname, {})
    return render_template(
        "index.html",
        username=uname,
        display_name=user.get("display_name") or uname,
        avatar_path=user.get("avatar_path") or "static/images/default_avatar.png"
    )

# -------------------- Settings --------------------
@app.route("/settings", methods=["GET"])
def settings():
    if "username" not in session:
        return redirect(url_for("login"))
    users = load_users()
    uname = session["username"]
    user = users.get(uname, {})
    return render_template(
        "settings.html",
        username=uname,
        display_name=user.get("display_name") or uname,
        email=user.get("email") or "",
        phone=user.get("phone") or "",
        avatar_path=user.get("avatar_path") or "static/images/default_avatar.png"
    )

@app.route("/api/settings", methods=["POST"])
def api_settings():
    if "username" not in session:
        return jsonify({"error": "Not logged in"}), 401
    users = load_users()
    uname = session["username"]
    data = request.form if request.form else request.json

    display_name = (data.get("display_name") or "").strip()
    email        = (data.get("email") or "").strip()
    phone        = norm_phone(data.get("phone"))
    password     = data.get("password") or None

    if display_name:
        users[uname]["display_name"] = display_name
    users[uname]["email"] = email
    users[uname]["phone"] = phone
    if password is not None and password != "":
        users[uname]["password"] = password

    save_users(users)
    return jsonify({"ok": True})

@app.route("/api/upload_avatar", methods=["POST"])
def api_upload_avatar():
    if "username" not in session:
        return jsonify({"error": "Not logged in"}), 401
    if "avatar" not in request.files:
        return jsonify({"error": "No file"}), 400
    file = request.files["avatar"]
    if file.filename == "":
        return jsonify({"error": "Empty filename"}), 400
    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify({"error": "Invalid file type"}), 400
    fname = secure_filename(f"{session['username']}_{int(time.time())}.{ext}")
    path = os.path.join(UPLOAD_DIR, fname)
    file.save(path)

    users = load_users()
    users[session["username"]]["avatar_path"] = f"static/uploads/{fname}"
    save_users(users)
    return jsonify({"ok": True, "avatar_path": f"/static/uploads/{fname}"})

# -------------------- Feature APIs (Test Mode; all free/local) --------------------
@app.route("/ask", methods=["POST"])
def ask():
    if "username" not in session:
        return jsonify({"error": "Not logged in"}), 401
    data = request.get_json() or request.form
    q = (data.get("question") or "").strip()
    mode = (data.get("mode") or "explain").strip()
    ans = get_ai_answer(q, mode)

    # Save to history
    users = load_users()
    uname = session["username"]
    users[uname].setdefault("history", []).insert(0, {
        "q": q, "a": ans, "ts": int(time.time())
    })
    save_users(users)
    return jsonify({"answer": ans})

@app.route("/api/history", methods=["GET"])
def api_history():
    if "username" not in session:
        return jsonify({"error": "Not logged in"}), 401
    users = load_users()
    uname = session["username"]
    return jsonify({"history": users[uname].get("history", [])})

@app.route("/api/flashcards", methods=["GET", "POST"])
def api_flashcards():
    if "username" not in session:
        return jsonify({"error": "Not logged in"}), 401
    users = load_users()
    uname = session["username"]

    if request.method == "POST":
        data = request.get_json() or {}
        front = (data.get("front") or "").strip()
        back  = (data.get("back") or "").strip()
        if not front or not back:
            return jsonify({"error": "Missing"}), 400
        card = {"front": front, "back": back, "id": int(time.time() * 1000)}
        users[uname].setdefault("flashcards", []).append(card)
        save_users(users)
        return jsonify({"ok": True, "card": card})

    return jsonify({"flashcards": users[uname].get("flashcards", [])})

@app.route("/api/planner", methods=["GET", "POST"])
def api_planner():
    if "username" not in session:
        return jsonify({"error": "Not logged in"}), 401
    users = load_users()
    uname = session["username"]

    if request.method == "POST":
        data = request.get_json() or {}
        title = (data.get("title") or "").strip()
        date  = (data.get("date") or "").strip()  # YYYY-MM-DD or ""
        if not title:
            return jsonify({"error": "Missing title"}), 400
        item = {"title": title, "date": date, "id": int(time.time() * 1000)}
        users[uname].setdefault("planner", []).append(item)
        save_users(users)
        return jsonify({"ok": True, "event": item})

    return jsonify({"planner": users[uname].get("planner", [])})

# -------------------- Legal Pages --------------------
@app.route("/terms")
def terms():
    return render_template("terms.html")

@app.route("/privacy")
def privacy():
    return render_template("privacy.html")

# -------------------- Static uploads (serve) --------------------
@app.route("/static/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)

# -------------------- Dev OAuth (Test Mode) --------------------
# Makes Google/Microsoft/GitHub/Apple buttons "work" without real OAuth.
# Set OAUTH_TEST_MODE=1 (default) to enable. Set to 0 to disable.
OAUTH_TEST_MODE = os.getenv("OAUTH_TEST_MODE", "1") == "1"

def _dev_oauth_login(provider):
    """
    Fake an OAuth login flow for testing.
    Creates a provider-based user if missing, logs them in, and goes to onboarding/index.
    """
    if not OAUTH_TEST_MODE:
        return "OAuth not configured (test mode off)", 501

    users = load_users()
    # Try to reuse a provider test user; if name taken with different provider, append suffix
    uname = f"{provider}_user"
    suffix = 1
    while uname in users and users[uname].get("settings", {}).get("provider") != provider:
        suffix += 1
        uname = f"{provider}_user{suffix}"

    if uname not in users:
        users[uname] = {
            "email": f"{provider}_test@local",
            "phone": "",
            "password": "",  # not used for OAuth test users
            "history": [],
            "flashcards": [],
            "planner": [],
            "settings": {"provider": provider},
            "display_name": provider.capitalize() + " User",
            "avatar_path": "static/images/default_avatar.png",
            "admin": False,
            "first_login": True
        }
        save_users(users)

    session["username"] = uname
    # first time, send to onboarding
    if users[uname].get("first_login"):
        return redirect(url_for("onboarding"))
    return redirect(url_for("index"))

@app.route("/auth/dev/<provider>", methods=["GET", "POST"])
def auth_dev(provider):
    provider = (provider or "").lower()
    if provider not in {"google", "microsoft", "github", "apple"}:
        return "Unknown provider", 404
    return _dev_oauth_login(provider)

# -------------------- Health (for Render) --------------------
@app.route("/health")
def health():
    return "ok", 200

# -------------------- Run (local only; Render uses gunicorn) --------------------
if __name__ == "__main__":
    host = os.environ.get("FLASK_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host=host, port=port, debug=debug)
