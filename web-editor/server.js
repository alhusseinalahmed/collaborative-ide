const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const axios = require("axios");
const { createClient } = require("redis");

const app = express();
app.use(cors());
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
});

const GO_URL = process.env.GO_API_URL || "http://localhost:8080/execute";
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.log('Redis Client Error', err));

async function startServer() {
    await redisClient.connect();
    console.log("Connected to Redis");

    io.on("connection", (socket) => {
        console.log(`User connected: ${socket.id}`);

        socket.on("join-room", async (roomId) => {
            socket.join(roomId);
            const storedRoom = await redisClient.get(roomId);

            let roomData;
            if (storedRoom) {
                roomData = JSON.parse(storedRoom);
            } else {
                roomData = { code: 'print("Hello World")', language: "python" };
                await redisClient.set(roomId, JSON.stringify(roomData));
            }

            socket.emit("code-update", roomData.code);
            socket.emit("language-update", roomData.language);
        });

        socket.on("code-update", async ({ roomId, code }) => {
            socket.to(roomId).emit("code-update", code);
            const storedRoom = await redisClient.get(roomId);
            if (storedRoom) {
                const data = JSON.parse(storedRoom);
                data.code = code;
                await redisClient.set(roomId, JSON.stringify(data));
            }
        });

        socket.on("language-change", async ({ roomId, language }) => {
            socket.to(roomId).emit("language-update", language);
            const storedRoom = await redisClient.get(roomId);
            if (storedRoom) {
                const data = JSON.parse(storedRoom);
                data.language = language;
                await redisClient.set(roomId, JSON.stringify(data));
            }
        });

        // ENSURE THIS APPEARS ONLY ONCE
        socket.on("run-code", async ({ roomId, language, code }) => {
            console.log(`Running ${language} in room ${roomId}`);
            try {
                const response = await axios.post(GO_URL, {
                    language: language,
                    code: code,
                });
                socket.emit("execution-result", response.data);
            } catch (error) {
                console.error(error);
                socket.emit("execution-result", { error: "Execution failed" });
            }
        });
    });

    const PORT = 3000;
    server.listen(PORT, () => {
        console.log(`Web Editor running on http://localhost:${PORT}`);
    });
}

startServer();