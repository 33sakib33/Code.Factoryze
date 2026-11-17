FROM python:3.13-slim-bookworm@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f
LABEL org.factoryze.grader.version="1"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONHASHSEED=0 TZ=UTC
COPY --chmod=0555 runner.py /opt/factoryze/runner.py
USER 10000:10000
WORKDIR /work
CMD ["python", "-I", "/opt/factoryze/runner.py", "health"]
