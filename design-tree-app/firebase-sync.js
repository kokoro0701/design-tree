// =====================================================================
// 独立アプリ版: Firebase でログインと同期をする部分
//
//   - ログイン: メールアドレス + パスワード (Firebase Authentication)
//   - 同期: Cloud Firestore の users/<ユーザーID>/projects/<プロジェクトID>
//           (セキュリティルールで、本人しか読み書きできないようにする → firestore.rules)
//   - アプリ本体 (index.html) とは window.DesignTreeCloud を通してだけつながる
//   - Firebase を読み込めないとき (設定なし・初回オフラインなど) は、端末だけに保存して動く
// =====================================================================
const SDK = "https://www.gstatic.com/firebasejs/12.19.0/";

const $ = (id) => document.getElementById(id);
let auth = null;
let authApi = null;
let currentUser = null;

// Firebase のエラーを、分かりやすい日本語にする
function messageFor(err) {
  const code = (err && err.code) || "";
  const table = {
    "auth/invalid-email": "メールアドレスの形が正しくありません。",
    "auth/missing-password": "パスワードを入力してください。",
    "auth/weak-password": "パスワードは6文字以上にしてください。",
    "auth/email-already-in-use": "このメールアドレスはもう登録されています。「ログイン」を押してください。",
    "auth/invalid-credential": "メールアドレスかパスワードが違います。",
    "auth/wrong-password": "メールアドレスかパスワードが違います。",
    "auth/user-not-found": "このメールアドレスは登録されていません。「新しく登録する」を押してください。",
    "auth/too-many-requests": "何度も失敗したので、少し待ってからもう一度試してください。",
    "auth/network-request-failed": "インターネットにつながっていません。つながってからもう一度試してください。",
    "auth/operation-not-allowed": "Firebase の設定で「メール/パスワード」のログインが有効になっていません (手順書の 2 を確認してください)。"
  };
  return table[code] || "うまくいきませんでした (" + (code || "不明なエラー") + ")。";
}

// Firestore のエラーコードを、アプリ本体が使っている名前にそろえる
function mapError(err) {
  const map = {
    "permission-denied": "invalid_argument",
    "invalid-argument": "invalid_argument",
    "resource-exhausted": "quota_exceeded",
    "unavailable": "unavailable"
  };
  return { code: map[err && err.code] || "unavailable", message: (err && err.message) || "" };
}

async function start() {
  const config = window.FIREBASE_CONFIG;
  if (!config || !config.apiKey) return; // 設定がまだ → 端末だけに保存 (アプリ本体はそのまま動く)
  $("account-row").hidden = false;

  let appMod, authMod, fsMod;
  try {
    [appMod, authMod, fsMod] = await Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-auth.js"),
      import(SDK + "firebase-firestore.js")
    ]);
  } catch (e) {
    // 初めて開いたときにオフラインだった など
    window.DesignTreeCloud.setStatus("error");
    $("account-email").textContent = "Firebase に接続できません (この端末には保存されます)";
    return;
  }

  const app = appMod.initializeApp(config);
  authApi = authMod;
  auth = authMod.getAuth(app);
  let db;
  try {
    // オフラインでも使えるよう、端末にもキャッシュする
    db = fsMod.initializeFirestore(app, { localCache: fsMod.persistentLocalCache() });
  } catch (e) {
    db = fsMod.getFirestore(app);
  }

  // ログイン状態が変わったとき (起動時の自動ログインも含む)
  authMod.onAuthStateChanged(auth, (user) => {
    currentUser = user;
    renderAccount();
    if (!user) return;
    const col = fsMod.collection(db, "users", user.uid, "projects");
    // アプリ本体が使う形 (onSnapshot / doc(id).set / doc(id).delete) に合わせる
    const projectsRef = {
      onSnapshot: (next, onError) => fsMod.onSnapshot(col, { includeMetadataChanges: true }, next, onError),
      doc: (id) => ({
        set: (body) => fsMod.setDoc(fsMod.doc(col, id), body).catch((e) => { throw mapError(e); }),
        delete: () => fsMod.deleteDoc(fsMod.doc(col, id)).catch((e) => { throw mapError(e); })
      })
    };
    window.DesignTreeCloud.connect(projectsRef, user.uid);
  });
}

// ---- アカウント画面 ----
function renderAccount() {
  const signedIn = !!currentUser;
  $("account-btn").textContent = signedIn ? "アカウント" : "ログイン";
  $("account-email").textContent = signedIn ? currentUser.email : "ログインするとスマホと PC で同期できます";
  $("account-title").textContent = signedIn ? "アカウント" : "ログイン";
  $("account-signed-out").hidden = signedIn;
  $("account-actions-out").hidden = signedIn;
  $("account-signed-in").hidden = !signedIn;
  $("account-actions-in").hidden = !signedIn;
  if (signedIn) $("account-signed-in-text").textContent = currentUser.email + " でログインしています。プロジェクトはこのアカウントに同期されます。";
}

function showError(text) {
  $("account-info").hidden = true;
  $("account-error").textContent = text;
  $("account-error").hidden = false;
}
function showInfo(text) {
  $("account-error").hidden = true;
  $("account-info").textContent = text;
  $("account-info").hidden = false;
}
function clearMessages() {
  $("account-error").hidden = true;
  $("account-info").hidden = true;
}

function openAccount() {
  clearMessages();
  renderAccount();
  $("account-dialog").hidden = false;
}
function closeAccount() {
  $("account-dialog").hidden = true;
}

async function withBusy(button, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "お待ちください…";
  try { await task(); } finally { button.disabled = false; button.textContent = label; }
}

function credentials() {
  return { email: $("account-email-input").value.trim(), password: $("account-password-input").value };
}

$("account-btn").addEventListener("click", openAccount);
$("account-close").addEventListener("click", closeAccount);

// ログイン (フォームの送信 = Enter キーでも)
$("account-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!auth) return showError("Firebase に接続できていません。");
  const c = credentials();
  withBusy($("account-login"), async () => {
    try {
      await authApi.signInWithEmailAndPassword(auth, c.email, c.password);
      $("account-password-input").value = "";
      closeAccount();
    } catch (err) { showError(messageFor(err)); }
  });
});

$("account-signup").addEventListener("click", () => {
  if (!auth) return showError("Firebase に接続できていません。");
  const c = credentials();
  withBusy($("account-signup"), async () => {
    try {
      await authApi.createUserWithEmailAndPassword(auth, c.email, c.password);
      $("account-password-input").value = "";
      closeAccount();
    } catch (err) { showError(messageFor(err)); }
  });
});

$("account-reset").addEventListener("click", () => {
  if (!auth) return showError("Firebase に接続できていません。");
  const email = $("account-email-input").value.trim();
  if (!email) return showError("メールアドレスを入れてから押してください。");
  withBusy($("account-reset"), async () => {
    try {
      await authApi.sendPasswordResetEmail(auth, email);
      showInfo(email + " にパスワード再設定のメールを送りました。");
    } catch (err) { showError(messageFor(err)); }
  });
});

$("account-logout").addEventListener("click", async () => {
  if (window.DesignTreeCloud.hasPendingChanges()) {
    const ok = window.confirm("まだクラウドに送っていない変更があります。ログアウトすると、この端末からは消えます。ログアウトしますか？");
    if (!ok) return;
  }
  await authApi.signOut(auth);
  window.DesignTreeCloud.disconnect(); // この端末のデータを消す (次に使う人に見えないように)
  closeAccount();
});

start();
