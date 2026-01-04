@echo off
echo Starting Redis and Web Editor in Docker...
start /B docker-compose up --build

echo Starting Go Runner...
cd runner
go run main.go