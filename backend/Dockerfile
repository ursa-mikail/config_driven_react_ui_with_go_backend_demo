FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN go mod tidy && CGO_ENABLED=0 go build -o /studio .

FROM alpine:3.20
COPY --from=build /studio /studio
CMD ["/studio"]
