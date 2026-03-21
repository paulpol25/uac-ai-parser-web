// Package crypto provides AES-256-GCM envelope encryption for agent payloads.
//
// Each agent is provisioned with a unique 256-bit symmetric key at
// registration. All command payloads and result bodies are encrypted
// before transmission, providing defence-in-depth on top of TLS.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

// Envelope wraps an encrypted payload with its nonce.
type Envelope struct {
	Nonce      string `json:"nonce"`      // base64-encoded nonce
	Ciphertext string `json:"ciphertext"` // base64-encoded ciphertext+tag
}

var (
	ErrNoKey         = errors.New("crypto: encryption key not configured")
	ErrDecryptFailed = errors.New("crypto: decryption failed (bad key or tampered data)")
)

// Engine performs symmetric encryption/decryption with a pre-shared key.
type Engine struct {
	gcm cipher.AEAD
}

// NewEngine creates an Engine from a base64-encoded 256-bit key.
// Returns nil (no-op mode) if key is empty.
func NewEngine(keyBase64 string) (*Engine, error) {
	if keyBase64 == "" {
		return nil, nil // encryption disabled
	}

	key, err := base64.StdEncoding.DecodeString(keyBase64)
	if err != nil {
		return nil, fmt.Errorf("crypto: bad base64 key: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("crypto: key must be 32 bytes, got %d", len(key))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("crypto: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("crypto: %w", err)
	}

	return &Engine{gcm: gcm}, nil
}

// Encrypt encrypts plaintext and returns a JSON-serializable envelope.
func (e *Engine) Encrypt(plaintext []byte) (*Envelope, error) {
	nonce := make([]byte, e.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("crypto: generate nonce: %w", err)
	}

	ciphertext := e.gcm.Seal(nil, nonce, plaintext, nil)

	return &Envelope{
		Nonce:      base64.StdEncoding.EncodeToString(nonce),
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext),
	}, nil
}

// Decrypt decrypts an envelope back to plaintext.
func (e *Engine) Decrypt(env *Envelope) ([]byte, error) {
	nonce, err := base64.StdEncoding.DecodeString(env.Nonce)
	if err != nil {
		return nil, fmt.Errorf("crypto: decode nonce: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(env.Ciphertext)
	if err != nil {
		return nil, fmt.Errorf("crypto: decode ciphertext: %w", err)
	}

	plaintext, err := e.gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, ErrDecryptFailed
	}

	return plaintext, nil
}

// Enabled returns true if the engine is active (key was provided).
func (e *Engine) Enabled() bool {
	return e != nil && e.gcm != nil
}
