package config

import (
	"crypto/x509"
	"fmt"
	"os"
)

// loadCertPool loads a PEM-encoded CA certificate file into a cert pool.
func loadCertPool(certPath string) (*x509.CertPool, error) {
	caCert, err := os.ReadFile(certPath)
	if err != nil {
		return nil, fmt.Errorf("read CA cert: %w", err)
	}

	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caCert) {
		return nil, fmt.Errorf("failed to parse CA cert from %s", certPath)
	}

	return pool, nil
}
