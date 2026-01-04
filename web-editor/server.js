const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
});

const GO_RUNNER_URL = "http://localhost:8080/execute";

// Store the state of each room in memory (Run code + Language)
// Format: { "room-id": { code: "...", language: "python" } }
const roomStates = {};

io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    // 1. User Joins a Room
    socket.on("join-room", (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room: ${roomId}`);

        // If room doesn't exist, initialize it
        if (!roomStates[roomId]) {
            roomStates[roomId] = {
                code: 'print("Hello World")',
                language: "python"
            };
        }

        // Send current state to the NEW user only
        const state = roomStates[roomId];
        socket.emit("code-update", state.code);
        socket.emit("language-update", state.language);
    });

    // 2. Sync Code Changes
    socket.on("code-update", ({ roomId, code }) => {
        if (!roomStates[roomId]) return;

        // Update server memory
        roomStates[roomId].code = code;

        // Broadcast to everyone else in the room
        socket.to(roomId).emit("code-update", code);
    });

    // 3. Sync Language Changes (The Fix for your Bug!)
    socket.on("language-change", ({ roomId, language }) => {
        if (!roomStates[roomId]) return;

        // Update server memory
        roomStates[roomId].language = language;

        // Broadcast to everyone else in the room
        socket.to(roomId).emit("language-update", language);
    });

    // 4. Run Code
    socket.on("run-code", async ({ roomId, code }) => {
        if (!roomStates[roomId]) return;

        const language = roomStates[roomId].language;
        console.log(`Running ${language} in room ${roomId}`);

        try {
            const response = await axios.post(GO_RUNNER_URL, {
                language: language,
                code: code,
            });
            // Send result back to the specific user
            socket.emit("execution-result", response.data);
        } catch (error) {
            console.error("Runner Error:", error.message);
            socket.emit("execution-result", { error: "Failed to connect to execution engine" });
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Web Editor running on http://localhost:${PORT}`);
});