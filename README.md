# nominate-client

```
Usage: nominate-client [options]

Options:
  -v, --vers                   output the current version
  -p, --para-ws <string>       The Parachain API endpoint to connect to. (default: "ws://127.0.0.1:9944")
  -r, --relay-ws <string>      The Relaychain API endpoint to connect to. (default: "wss://kusama-rpc.polkadot.io")
  -s, --seed <string>          The account seed to use (default: "//Eve")
  -i, --interactive [boolean]  Input seed interactively (default: false)
  -h, --help                   display help for command
```

## Docker image

```
docker run --init -it parallelfinance/nominate-client
```
