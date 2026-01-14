The compose.yaml file is now updated to build your local code.

To build the container image and start the service in the background, run this command from the root
of your project:

 1 docker compose -f scripts/compose.yaml up -d --build
 * up: Creates and starts the container.
 * --build: Builds the image from your local code using scripts/Dockerfile.
 * -d: Runs the container in "detached" mode (in the background).

After you run this, your production-ready, containerized application will be running and accessible
at http://localhost:5230.

Here are some useful commands:
 * To view the logs: docker compose -f scripts/compose.yaml logs -f
 * To stop the application: docker compose -f scripts/compose.yaml down

