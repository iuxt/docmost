variable "ITIER_VERSION" {
  default = "latest"
}

variable "IMAGE_PREFIX" {
  default = "docmost"
}

group "default" {
  targets = ["docmost"]
}

target "docmost" {
  context    = "."
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_PREFIX}/docmost:${ITIER_VERSION}"]
  platforms  = ["linux/amd64", "linux/arm64"]
  # Alibaba ACR rejects the OCI artifacts used for build attestations.
  attest = [
    "type=provenance,disabled=true",
    "type=sbom,disabled=true",
  ]
}
