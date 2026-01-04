package main

import (
	"bytes"
	"context" // <--- CHANGE 1: Import context
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"time" // <--- CHANGE 2: Import time
)

type ExecutionRequest struct {
	Language string `json:"language"`
	Code     string `json:"code"`
}

type ExecutionResponse struct {
	Output string `json:"output"`
	Error  string `json:"error,omitempty"`
}

// executeHandler handles a POST request to execute a snippet of code in a Docker container.
//
// The request body should contain a JSON object with the following structure:
//
//	{
//	 "language": string, // Language of the code. Currently only "python" is supported.
//	 "code": string // Code to be executed.
//	}
//
// The response will be a JSON object with the following structure:
//
//	{
//	 "output": string, // Output of the executed code.
//	 "error": string, // Error message if execution failed. May be empty.
//	}
//
// If the execution takes longer than 2 seconds, the execution will be terminated and the response will contain an error message.
func executeHandler(w http.ResponseWriter, r *http.Request) {
	var req ExecutionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", 400)
		return
	}

	tmpFile, err := os.CreateTemp("", "usercode-*.py")
	if err != nil {
		http.Error(w, "Could not create file", 500)
		return
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(req.Code); err != nil {
		http.Error(w, "Could not write to file", 500)
		return
	}
	tmpFile.Close()

	// Create a "Context" with a 2-second timeout.
	// This creates a timer. If the timer hits 2s, the context "dies".
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel() // Clean up the timer when we are done

	// Resource Limits ---
	// We add flags to restrict the container:
	// --memory 128m: Crash if it uses > 128MB RAM
	// --cpus 0.5: Use max 50% of one CPU core
	// --network none: Disable Internet access (Security!)
	cmd := exec.CommandContext(ctx, "docker", "run", "--rm",
		"--memory=128m",
		"--cpus=0.5",
		"--network=none",
		"-v", fmt.Sprintf("%s:/app/script.py", tmpFile.Name()),
		"python:3.9-alpine",
		"python", "/app/script.py",
	)

	// Separate Output Streams ---
	// We create two buffers to capture streams separately
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	// Run the command
	err = cmd.Run()

	// Handle Timeouts specifically
	if ctx.Err() == context.DeadlineExceeded {
		stderrBuf.WriteString("\nExecution Timed Out (Limit: 2s)")
	}

	// Prepare response
	resp := ExecutionResponse{
		Output: stdoutBuf.String(),
		Error:  stderrBuf.String(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// Main entry point for the service.
// This function sets up an HTTP server that listens on port 8080
// and handles incoming requests to /execute.
// It will start the server and block until an error occurs.
func main() {
	http.HandleFunc("/execute", executeHandler)
	fmt.Println("Runner Service starting on :8080...")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		fmt.Println("Server failed:", err)
	}
}
