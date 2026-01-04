const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

// Serve the frontend files
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow connections from anywhere for now
        methods: ["GET", "POST"],
    },
});

// The URL of your Go Runner Service
const GO_RUNNER_URL = "http://localhost:8080/execute";

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // 1. COLLABORATION: Sync Code
    // When 'code-update' is received from one user...
    socket.on("code-update", (code) => {
        // ...broadcast it to everyone else (except the sender)
        socket.broadcast.emit("code-update", code);
    });

    // 2. EXECUTION: Run Code via Go
    socket.on("run-code", async (data) => {
        const { language, code } = data;
        console.log(`Requesting execution for ${socket.id}`);

        try {
            // Call the Go Service
            const response = await axios.post(GO_RUNNER_URL, {
                language: language,
                code: code,
            });

            // Send the result back to the specific user who asked
            socket.emit("execution-result", response.data);
        } catch (error) {
            console.error("Runner Error:", error.message);
            socket.emit("execution-result", {
                output: "",
                error: "Failed to connect to Execution Service.",
            });
        }
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Web Editor running on http://localhost:${PORT}`);
});