FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum* main.go ./
# With a go.sum (run ./lock once) the build is reproducible and refuses to change dependencies.
RUN if [ -f go.sum ]; then go build -mod=readonly -o /studio . ; else go mod tidy && go build -o /studio . ; fi

FROM alpine:3.20
COPY --from=build /studio /studio
CMD ["/studio"]
