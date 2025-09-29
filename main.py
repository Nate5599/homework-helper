import os, json, time, re
from flask import (
    Flask, request, render_template, jsonify,
    redirect, url_for, session, send_from_directory
)
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# -------------------- App & Config --------------------
load_dotenv()
app = Flask(__name__)
# Only allow known hosts (set your Render domain later)
ALLOWED_HOSTS = set(filter(None, os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")))

@app.before_request
def _restrict_hosts():
    host = (request.headers.get("Host") or "").split(":")[0].lower()
    if host and host not in ALLOWED_HOSTS:
        return "Bad Request (host not allowed)", 400


# Secret key for sessions (dev-safe). In production, set via env var.
app.secret_key = os.getenv("FLASK_SECRET_KEY") or os.urandom(24)

# Files & uploads
# Files & uploads
# Use a persistent disk path if available (Render), else local folder.
PERSIST_DIR = os.environ.get("PERSIST_DIR", "")
if PERSIST_DIR and not os.path.exists(PERSIST_DIR):
    os.makedirs(PERSIST_DIR, exist_ok=True)

USERS_FILE = os.path.join(PERSIST_DIR or ".", "users.json")

UPLOAD_DIR = os.path.join("static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


ALLOWED_EXT = {"png", "jpg", "jpeg", "webp", "gif"}

# -------------------- Admin Defaults --------------------
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "AdminPass123!"       # you can change this in users.json or via Settings
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

def find_user(users, identifier):
    """
    Find by username (case-insensitive), email (case-insensitive), or phone (digits only).
    Returns (username_key, user_dict) or (None, None)
    """
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
        if norm_phone(u.get("phone")) == ident_phone and ident_phone:
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

# -------------------- Safe Test Mode “AI” --------------------
def get_ai_answer(question, mode="explain"):
    """
    Test mode only — NO external API calls. Always free and local.
    """
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
        if not username or not password or (not email and not phone):
            return render_template("signup.html", error="Username, password, and email or phone required")

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

# -------------------- Dev Helpers (local debug only) --------------------
@app.route("/dev/force_login/<uname>")
def dev_force_login(uname):
    """Quickly set session to a user while debug=True (local only)."""
    if not app.debug:
        return "Forbidden", 403
    users = load_users()
    if uname not in users:
        return f"User '{uname}' not found.", 404
    session["username"] = uname
    return redirect(url_for("index"))

@app.route("/dev/reset_admin_pw/<newpw>")
def dev_reset_admin_pw(newpw):
    """Reset admin password instantly (local only)."""
    if not app.debug:
        return "Forbidden", 403
    users = load_users()
    if "admin" not in users:
        return "Admin user missing.", 404
    users["admin"]["password"] = newpw
    save_users(users)
    return f"Admin password set to: {newpw}"


# -------------------- Run --------------------
# -------------------- Run --------------------
if __name__ == "__main__":
    import os
    host = os.environ.get("FLASK_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"  # local default True

    app.run(host=host, port=port, debug=debug)
