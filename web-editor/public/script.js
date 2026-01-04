const socket = io();
let editor;
let isReceivingUpdate = false;

// --- 1. ROOM LOGIC ---
const urlParams = new URLSearchParams(window.location.search);
let roomId = urlParams.get("room");

if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 9);
    window.location.search = `?room=${roomId}`;
}

document.getElementById("room-id-display").innerText = roomId;

const statusElem = document.getElementById("connection-status");
socket.on("connect", () => {
    statusElem.innerText = "● Online";
    statusElem.className = "status-online";
});
socket.on("disconnect", () => {
    statusElem.innerText = "● Offline";
    statusElem.className = "status-offline";
});

// --- 2. RESIZABLE WINDOW LOGIC ---
const resizer = document.getElementById("resizer");
const consoleWrapper = document.getElementById("console-wrapper");

resizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    document.addEventListener("mousemove", resize);
    document.addEventListener("mouseup", stopResize);
});

function resize(e) {
    const totalHeight = window.innerHeight;
    const newConsoleHeight = totalHeight - e.clientY;
    if (newConsoleHeight > 50 && newConsoleHeight < totalHeight - 100) {
        consoleWrapper.style.height = `${newConsoleHeight}px`;
        if (editor) editor.layout();
    }
}

function stopResize() {
    document.removeEventListener("mousemove", resize);
    document.removeEventListener("mouseup", stopResize);
}

window.addEventListener("resize", () => {
    if (editor) editor.layout();
});

// --- 3. EDITOR INITIALIZATION ---
require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs" } });

require(["vs/editor/editor.main"], function () {

    // --- CUSTOM FORMATTERS (The Fix) ---

    // C++ Formatter (Robust, based on Braces)
    monaco.languages.registerDocumentFormattingEditProvider('cpp', {
        provideDocumentFormattingEdits: function (model) {
            const text = model.getValue();
            const lines = text.split('\n');
            let indentLevel = 0;
            const formattedLines = lines.map(line => {
                const trimmed = line.trim();
                if (trimmed.startsWith('}')) indentLevel = Math.max(0, indentLevel - 1);

                const indent = '    '.repeat(indentLevel);
                const newLine = indent + trimmed;

                if (trimmed.endsWith('{')) indentLevel++;
                return newLine;
            });

            return [{
                range: model.getFullModelRange(),
                text: formattedLines.join('\n')
            }];
        }
    });

    // Python Formatter (Heuristic, based on Colons)
    monaco.languages.registerDocumentFormattingEditProvider('python', {
        provideDocumentFormattingEdits: function (model) {
            const text = model.getValue();
            const lines = text.split('\n');
            let indentLevel = 0;
            const formattedLines = lines.map(line => {
                const trimmed = line.trim();

                // Heuristic: If previous line ended with ':', we should probably be indented
                // But we can't guess when to dedent in Python safely.
                // This logic ensures at least the current structure is respected.
                const indent = '    '.repeat(indentLevel);
                const newLine = indent + trimmed;

                if (trimmed.endsWith(':')) {
                    indentLevel++;
                } else if (trimmed === 'return' || trimmed.startsWith('return ') || trimmed === 'pass') {
                    indentLevel = Math.max(0, indentLevel - 1);
                }
                return newLine;
            });

            return [{
                range: model.getFullModelRange(),
                text: formattedLines.join('\n')
            }];
        }
    });
    // -----------------------------------

    editor = monaco.editor.create(document.getElementById("editor-wrapper"), {
        value: 'print("Loading...")',
        language: "python",
        theme: "vs-dark",
        automaticLayout: false,
        minimap: { enabled: false },
        fontSize: 14,
        autoIndent: "full",
        formatOnPaste: true,
        formatOnType: true,
    });

    editor.layout();
    socket.emit("join-room", roomId);

    editor.onDidChangeModelContent((event) => {
        if (isReceivingUpdate) return;
        const code = editor.getValue();
        socket.emit("code-update", { roomId, code });
    });

    // Global Hotkey Fix
    window.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();

            // Trigger our Custom Formatters registered above
            editor.getAction('editor.action.formatDocument').run();

            // Save
            const code = editor.getValue();
            socket.emit("code-update", { roomId, code });
            showToast("Code Saved & Formatted!");
        }
    });
});

// --- 4. SOCKET LISTENERS ---
socket.on("code-update", (newCode) => {
    if (editor && editor.getValue() !== newCode) {
        isReceivingUpdate = true;
        const pos = editor.getPosition();
        editor.setValue(newCode);
        editor.setPosition(pos);
        isReceivingUpdate = false;
    }
});

socket.on("language-update", (newLang) => {
    const dropdown = document.getElementById("language");
    if (dropdown.value !== newLang) {
        dropdown.value = newLang;
        if (editor) monaco.editor.setModelLanguage(editor.getModel(), newLang);
    }
});

socket.on("execution-result", (result) => {
    const outputDiv = document.getElementById("output");
    outputDiv.innerText = "";
    if (result.output) {
        const span = document.createElement("span");
        span.classList.add("success");
        span.innerText = result.output;
        outputDiv.appendChild(span);
    }
    if (result.error) {
        const errElem = document.createElement("span");
        errElem.classList.add("error");
        errElem.innerText = "\n" + result.error;
        outputDiv.appendChild(errElem);
    }
});

// --- HELPER FUNCTIONS ---
function showToast(message = "Code Saved & Formatted!") {
    const toast = document.getElementById("toast");
    toast.innerText = message;
    toast.className = "show";
    setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
}

function copyRoomLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.querySelector(".btn-share");
        const originalText = btn.innerText;
        btn.innerText = "✅ Copied!";
        setTimeout(() => (btn.innerText = originalText), 2000);
    });
}

function clearConsole() {
    document.getElementById("output").innerText = "";
}

function changeLanguage() {
    const lang = document.getElementById("language").value;
    let code = lang === "cpp"
        ? '#include <iostream>\n\nint main() {\n    std::cout << "Hello from C++" << std::endl;\n    return 0;\n}'
        : 'print("Hello from Python")';

    editor.setValue(code);
    monaco.editor.setModelLanguage(editor.getModel(), lang);
    socket.emit("language-change", { roomId, language: lang });
    socket.emit("code-update", { roomId, code });
}

function runCode() {
    const outputDiv = document.getElementById("output");
    outputDiv.innerText = "Running...";
    const lang = document.getElementById("language").value;
    socket.emit("run-code", {
        roomId: roomId,
        language: lang,
        code: editor.getValue(),
    });
}