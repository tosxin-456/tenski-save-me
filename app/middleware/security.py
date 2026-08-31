"""
Password hashing using bcrypt directly.
(passlib 1.7.4 is incompatible with bcrypt 5.x, so we call bcrypt ourselves.)
bcrypt only uses the first 72 bytes of a password, so we truncate explicitly.
"""
import bcrypt


def hash_password(password: str) -> str:
    pw_bytes = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        pw_bytes = password.encode("utf-8")[:72]
        return bcrypt.checkpw(pw_bytes, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False
